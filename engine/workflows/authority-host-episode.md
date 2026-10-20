# Authority-Host Episode — a recurring narrator reel

For a real person's new dialogue, use the [talking-head default](README.md#talking-head-default):
approved voice plus a real reusable take, with its fallback/cost tradeoffs. Preserve a
good existing performance. The designed narrator/idle-bed initialization below is a
synthetic-channel variant; an approved real presenter does not need Phase A recasting.

A forward, **generative** recipe for one episode of a fireside book-explainer
*narrator* channel on the consolidated canonical VideoClaw tool surface (`tools/`). The
host is a single, locked identity that re-appears every episode; only the words
change. This is the canonical worked example (a proven authority-host rebuild)
rewritten as a portable recipe — the rebuild is *a* path, not the only one.

> **⚠️ Read this as PRINCIPLES, not a script to copy.** The elderly-British-fireside
> narrator, the ~155 WPM weighted delivery, and the journal/bust/embers seam set are ONE
> channel's locked identity — *instances*, not defaults. What transfers is the shape:
> build the narrator ONCE (face + voice_id + idle bed), then per episode only re-voice
> and re-sync. Your channel's register, art style, and voice come from its tenant pack.

> **The whole point of "corrected": build the NARRATOR ONCE, then re-voice and
> re-sync forever.** You do not regenerate the face per episode. Seedance does
> NOT generate the talking head and does NOT generate the voice. The identity
> (face + voice_id) is locked; each episode re-synthesizes a fresh VO from the
> locked voice and **lip-syncs the prebuilt host bed TO that VO** (fal sync-3).

> Lip-sync is **always** fal sync-3 via `lipsync_footage long`. Every step ships
> with an **EVAL** drawn from `skills/evaluation.md` — no step proceeds on its
> first output. Visual register, B-roll art style, and voice register come from
> the tenant's stated style; smart defaults are marked. Reference the shared
> skills rather than repeating them: `skills/voice.md` (design/synth/eval a
> voice), `skills/broll_styles.md` (ranked B-roll methods), `skills/art_styles.md`
> (locked still styles + `--reference` lock), `skills/evaluation.md` (the eval
> for every asset type).

---

## Input — what you start from + where each input comes from

| Input | Where it comes from |
|---|---|
| **Locked host bed** (`footage/host_bed.mp4`, ~60–75s, 9:16, idle-talking loop) | Built ONCE in **Phase A** below; thereafter copied from the channel store (the channel asset map → `<host_bed>.mp4`). Reused every episode. |
| **Locked voice_id** | Designed ONCE via `synth_voice --mode design` (see `skills/primitives/synth_voice.md#design`); saved to `<channel>/voice/voice.json`. Rebuild's value: `<LOCKED_VOICE_ID>` (the channel's locked narrator voice, a deep RP baritone). The real value lives in that tenant's pack COMMITMENTS. Reused every episode. |
| **Episode passage / source idea** | The book + the one line worth keeping. The human supplies the book; you draft the script (Phase B step 1). |
| **Audio bed** (fireplace / ambience) | Search `sfx_catalog` first. If no rights-cleared cue fits, omit it or ask for a licensed user file; do not browse or generate one. |
| **Art style for seam B-roll** | The tenant's stated visual register → a locked style from `skills/art_styles.md`. (The worked example's channel locked painterly chiaroscuro fireside — journal/bust/embers; YOURS comes from the tenant register.) |

`PER-EPISODE inputs that change: the passage and the audio bed. EVERYTHING ELSE
is the locked narrator.` All tools take `--job <id>` explicitly (concurrent jobs
clobber `.current_job`).

The face, voice/register, B-roll style, and bed mood can be summarized in one
front-loaded creative rundown, but it is never an engine approval gate. Every EVAL below is an internal mechanical check on an
intermediate asset—not another human approval. Paid-operation authorization is a separate host/gateway
boundary; the engine does not require a grouped budget decision.

---

# Phase A — BUILD THE NARRATOR ONCE  `[GENERIC]`

Run this block exactly once per channel. The outputs are the locked, reusable
host bed + voice_id that every episode in Phase B consumes. If the channel
already has them (`voice.json` + `host_bed_*.mp4`), **skip Phase A entirely** and
go to Phase B step 0.

### A1. Cast the narrator face — one locked identity  `[BRAND: authority-host]`
**(a) Generate:** the host's identity-locked front anchor (the channel's locked narrator).
**(b) Command:**
```bash
uv run python tools/cast_avatar.py --job $JOB --role narrator --accent British \
  --with-profile
# → avatar/avatar_front.png (+ avatar_profile.png), character_sheet.json
```
**(c) Input:** the tenant's host brief (age/register/wardrobe/room). For this
channel: elderly aristocratic British man, fireside study, **no legible-text
props** (books/diplomas garble — instant AI-tell; use shape-credibility props per
`skills/avatar_prompting_guide.md`). `--accent` locks the spoken accent into the
sheet so it can't drift.
**(d) Why:** the face is generated ONCE and frozen; every episode reuses it.
**(e) EVAL** — *avatar IMAGE* path (`skills/evaluation.md` §1): a still has no
motion/audio, so **no Gemini**. `Read avatar/avatar_front.png` inline (mandatory
— assess the image itself, never just a path); eyeball anti-uncanny + 3+
credibility props + zero legible-text props. Select the strongest grounded passing
variant by default; surface options for optional casting feedback, and pause only
when the user explicitly requested selection or every variant materially misses.

### A2. Design the locked voice — one voice_id forever  `[BRAND: authority-host]`
**(a) Generate:** an original synthetic voice (commercial-safe, no cloning) from
a text casting brief, then promote the strongest register-matched preview to a permanent id.
**(b) Command:** see `skills/primitives/synth_voice.md#design` for the two-call preview → save
flow; consolidated surface:
```bash
uv run python tools/synth_voice.py --job $JOB --mode design \
  --description "Elderly aristocratic British man, deep gravelled RP baritone, slow weighted fireside delivery, sharp-authoritative." \
  --text "<~120-char real line from a sample episode>" --name host_v1
# listen to previews and select the strongest generated_voice_id → re-run --mode design with
# --save-preview <id> --voice-name "<channel's locked narrator voice>" → writes voice/voice.json
```
**(c) Input:** the current channel's delivery direction and pace (`skills/voice.md`).
This worked example uses `sharp-authoritative` × slow band, baked into the
`--description`.
**(d) Why:** design once → reference the `voice_id` forever. The `generated_voice_id`
(preview) ≠ the final `voice_id` — only `save` mints the reusable id.
**(e) EVAL** — *voice* path (`skills/evaluation.md` §2 / `skills/voice.md#4-verify-before-assembly`): voice
casting is part of the one front-loaded channel decision. Select against the stated
register and mechanical audio checks by default; surface previews when useful for optional
feedback, and pause only for an explicitly requested casting choice or when every preview
materially misses. This original-voice default never bypasses consent for real-person
likeness or voice cloning. During production use
`verify_output --mode audio` for timestamped glitches; do not invent a
`review_output` audio mode or create another approval checkpoint.

### A3. Animate the locked face into a ~60s idle-talking BED  `[GENERIC]`
**(a) Generate:** a still establishing shot of the host, then a long, quiet
idle-talking loop (subtle breathing, micro head-motion, mouth gently
moving/closed) chained into a ~60–75s bed. This bed is the **mouth canvas** every
episode lip-syncs onto.
**(b) Command:** mint the establishing frame, then keyframe-animate a clip and
chain to length:
```bash
uv run python tools/mint_image.py --job $JOB --role avatar_shot --name host_idle_frame \
  --reference avatar/avatar_front.png \
  --prompt "The same man seated by a low fire, hands folded, calm, looking to camera; warm amber firelight, deep chiaroscuro; no text." \
  --aspect 9:16 --quality high
uv run python tools/mint_video.py --job $JOB --mode keyframe \
  --first-frame jobs/$JOB/images/host_idle_frame.png \
  --output jobs/$JOB/footage/host_bed.mp4 \
  --prompt "The seated man breathes and gives subtle natural micro head-motion and idle mouth movement as if mid-thought; firelight flickers; camera holds rock-steady; no people entering, no text, no large gestures." \
  --duration 10 --resolution 720p --no-audio
# repeat / loop-concat to a ~60-75s silent bed (the VO sets final length in B3).
```
*(Channels with a real on-camera host instead pull genuine footage via
`pull_video --mode pull` and skip A1–A3.)*
**(d) Why:** sync models need a continuous face track to drive; a long idle bed
gives every future VO frames to land on. Generate ONCE; never regenerate per
episode.
**(e) EVAL** — *video clip* path (`skills/evaluation.md` §3): send the bed to
Gemini — `gemini_video.py --mode chunk_review` (or `verify_output --mode render
--strip` for a filmstrip + `Read` it). Confirm identity holds across the loop,
no anatomy/face warping, camera steady. Regenerate ONLY on a mechanical defect,
never on "feels stiff."

> **Phase A outputs (the locked narrator):** `footage/host_bed.mp4` +
> `voice/voice.json` (`voice_id`). Copy both into the channel store; every
> episode below reuses them verbatim.

---

# Phase B — PER EPISODE  (run this block every time)

## B0. Stage the locked narrator into the episode job  `[GENERIC]`
**(a) Generate:** nothing — copy the frozen assets in.
**(b) Command:**
```bash
cd "$VIDEOCLAW_WORKSPACE"
JOB="replace-with-the-same-canonical-bare-id"
mkdir -p jobs/$JOB/voice jobs/$JOB/footage jobs/$JOB/tts jobs/$JOB/images jobs/$JOB/broll jobs/$JOB/lipsync
cp <channel_store>/<host_bed>.mp4 jobs/$JOB/footage/host_bed.mp4
cp <channel_store>/voice/voice.json jobs/$JOB/voice/voice.json   # → voice_id
```
One-time-per-checkout Remotion setup (stub orphan caption imports so the bundler
doesn't fail on other jobs): see the shared Remotion-setup step (identical to
`avatar-speaker.md` Step 0).
**(d) Why:** the episode inherits the locked identity; only the words change.
**(e) EVAL:** none (a copy) — but confirm `voice.json` holds the expected
`voice_id` before starting downstream voice or video work.

## B1. Write the episode script — wound-first, ~155 WPM budget  `[BRAND: authority-host]`
**(a) Generate:** ONE `narration` chunk. Doctrine: lead with the universal wound,
withhold the name, reveal the turn LATE (e.g. "a Roman emperor → Marcus Aurelius →
*Meditations*"). Contractions throughout; one killer line; end on a quiet
instruction. **Run the AI-ISM blocklist** (no em dashes, no rule-of-three, never
the word "quiet").
**(b) Command:** authored by hand into `jobs/$JOB/script.json`. **Word budget:**
keep dialogue **≤ ~177 words** so the VO lands **under the bed length** (177 words
→ ~68.5s @ 155 WPM); overshoot the bed and the lip-sync has no frames.
**(c) Input:** the book + the one keeper line; voice doctrine from
`skills/voice.md` and the channel's voice corpus.
**(d) Why:** a faceless-ish narrator piece lives or dies on words × the locked voice.
**(e) EVAL — see B2** (`check_script` is the gate; it runs before any credits).

## B2. check_script `--method lipsync` — pre-generation EVAL GATE  `[GENERIC]`
**(a) Generate:** the structural + editorial audit verdict.
**(b) Command:**
```bash
uv run python tools/check_script.py --job $JOB --method lipsync --role narrator
# --method lipsync SKIPS the Seedance gate ([Image1] token + every-sentence-
# quoted-in-seedance_prompt) — the narrator bed runs NO Seedance. Only the
# method-agnostic checks apply: WPM, word-budget vs bed length, proper-noun
# phonetic-respell. Expect 0 BLOCKING.
```
**(c) Input:** `script.json` from B1.
**(d) Why:** catch a wrong word / over-budget length / mispronounceable name
before downstream TTS + sync calls.
**(e) EVAL:** this step *is* the eval (`skills/evaluation.md` "Final render →
check_script / pre-gen" rung). 0 BLOCKING required; fix and re-run on any block.

## B3. synth_voice — VO from the LOCKED voice, ~155 WPM, NO densify  `[BRAND: authority-host]`
**(a) Generate:** one continuous TTS take of the whole narration from the locked
`voice_id`.
**(b) Command:**
```bash
DIA=$(uv run python -c "import json;print(json.load(open('jobs/$JOB/script.json'))['chunks'][0]['dialogue'])")
uv run python tools/synth_voice.py --job $JOB --mode tts \
  --voice <voice_id from voice.json> --text "$DIA" --beat-id narration --wpm 155
# → tts/narration.stretched.mp3 (natural ~145 WPM → gentle stretch to ~155)
# DO NOT run densify.py — the slow fireside pace IS the product. (densify is the
# 215-220 WPM punchy-short-form path; wrong register for this channel.)
```
**(c) Input:** the dialogue text + the locked `voice_id`.
**(d) Why:** with the face barely moving, the voice *is* the brand; the slow
weighted delivery is non-negotiable.
**(e) EVAL** — *voice* path (`skills/evaluation.md` §2): deterministic
Scribe-v2 transcript-diff vs `--text` for mispronunciation (fix by phonetic
respell, re-synth); then `verify_output --mode audio --input tts/narration.stretched.mp3`
(no clipping, mean ~−17 dB). The front-loaded decision covers
naturalness/register; do not interrupt the run for another take approval unless
the result materially departs from it.

## B4. lipsync_footage long — fal sync-3 the bed onto the new VO  `[GENERIC]`
**(a) Generate:** the lip-synced spine — the locked host bed driven to the fresh
VO, length following the VO.
**(b) Command:**
```bash
uv run python tools/lipsync_footage.py long --job $JOB \
  --video jobs/$JOB/footage/host_bed.mp4 \
  --audio jobs/$JOB/tts/narration.stretched.mp3 \
  --output jobs/$JOB/lipsync/host_lipsynced.mp4 \
  --max-seg 50    # sync models fail past ~60s; long-mode splits at silence + restitches
# → lipsync/host_lipsynced.mp4 (length = VO, ~68s)
```
This is fal `sync-lipsync/v3` under the hood (`skills/broll_styles.md` Method 4).
**ZERO reproduction/copy/blueprint** — it re-drives the locked identity to new
audio, nothing is copied.
**(c) Input:** the locked bed (B0) + the episode VO (B3).
**(d) Why:** re-syncing the mouth (not regenerating the face) is what makes the
identity locked and the channel recurring.
**(e) EVAL** — *video clip* path (`skills/evaluation.md` §3): `verify_output
--mode render --input lipsync/host_lipsynced.mp4 --strip` → `Read` the filmstrip
(host consistent, no warp). Then `gemini_video.py --mode chunk_review` to catch
**lip-sync drift with a timestamp** (the one defect a still can't show) and any
seam stutter at the silence splits (~15s segment boundaries). Regen only on
mechanical drift.

## B5. mint_image + mint_video — seam B-roll cutaways  `[BRAND: authority-host]`
**(a) Generate:** artistic stills to cut away over the lip-sync **segment seams**
(the ~15s stitch points B4 introduces), then animate the establishing still into
a living clip. Hides any seam stutter AND adds the visual storytelling.
**(b) Command:** pick the locked still style from `skills/art_styles.md`
(`--reference` style-lock idiom); default painterly fireside set:
```bash
uv run python tools/mint_image.py --job $JOB --role artistic_still --name seam_journal \
  --prompt "A weathered leather-bound journal open on dark oak beside a low oil lamp, warm amber firelight, deep chiaroscuro, no legible writing, painterly cinematic, vertical, shallow DoF" \
  --aspect 2:3 --quality high
# (repeat for seam_bust: marble bust of a bearded emperor; seam_embers: dying coals)

uv run python tools/mint_video.py --job $JOB --mode keyframe \
  --first-frame jobs/$JOB/images/seam_journal.png \
  --output jobs/$JOB/broll/seam_journal_clip.mp4 \
  --prompt "Extremely slow cinematic push-in on the open journal beside a flickering oil lamp; flame flickers, embers drift, dust motes float; everything else still; no camera shake, no people, no text appearing." \
  --duration 5 --resolution 720p --no-audio
# keyframe interpolation = skills/broll_styles.md Method 3 (HIGH/locked).
# NO legible-text props (MEMORY rule); a transient Replicate ReadTimeout is retryable.
```
**(c) Input:** the seam timestamps from B4's segment splits + the locked art style.
**(d) Why:** a single still over a 4s+ window goes dead (`broll_styles.md` rule 5)
— each seam gets NEW motion content, and the cutaway masks the stitch.
**(e) EVAL** — *image* (`Read` each still inline; no Gemini on a still) + *video
clip* (`gemini_video.py --mode chunk_review` on each animated seam — steady
camera, no text appearing, no morph).

## B6. pull_video — find + screen the audio bed online  `[BRAND: authority-host]`
**(a) Generate:** nothing — **find** a real fireplace/ambience bed online (per the
rights/provenance-first ethos; catalog assets or licensed user files only, and we do NOT synth the bed).
**(b) Command:**
```bash
uv run python tools/pull_video.py --job $JOB --mode pull --url "<fireplace ambience url>" \
  --name fireplace_bed --bed --audio-only --out <dur>
# --bed extracts a clean audio bed ready to sit under the VO; → footage/fireplace_bed.mp3
```
**(c) Input:** a sourced ambience URL (or a user-dropped file via `--file`).
**(d) Why:** the ambient bed gives the piece a room to live in under the VO;
sourced beds beat synthetic ones for this register.
**(e) EVAL** — *audio bed* (`skills/evaluation.md` §2):
`verify_output --mode audio --input footage/fireplace_bed.mp3` measures clipping
and dropouts only. Then do an explicit listening check for **vocals in the bed**,
a loop seam, and a voice-band (250Hz–3kHz) collision that would fight the VO; any
of them → re-source. When you cannot listen yourself, give the user the playable
bed and say what to listen for (the `bed-find-and-screen` molecule). The
front-loaded decision owns the mood; this check does not raise another approval.

## B7. transcript + assemble + compose_render — bed, captions, seam inserts  `[GENERIC]`
**(a) Generate:** word-timed captions, then the final composite (lip-sync spine +
sentence captions + ambience bed held steady under the VO + seam B-roll cut over the
stitch points).
**(b) Command:**
```bash
# Scribe-v2 word timings (round-trips proper nouns → pronunciation check)
uv run python tools/synth_voice.py --job $JOB --mode transcribe \
  --audio lipsync/host_lipsynced.mp4 --skip-stitch        # → transcript.json

```
Author this job-relative `edl.json`; `assemble` replaces the lip-sync file's
audio with the exact TTS take and lays the sourced bed under it at one steady,
quiet ambience level (`gain` 0.08, no ducking):
```json
{
  "beats": [
    {"name":"host","role":"face","source":"lipsync/host_lipsynced.mp4","source_kind":"generated"}
  ],
  "audio": {
    "from_beats": false,
    "vo": {"source":"tts/narration.stretched.mp3","gain":1.0},
    "bed": {"source":"footage/fireplace_bed.mp3","gain":0.08}
  },
  "output":"final_raw.mp4"
}
```
```bash
uv run python tools/assemble.py --job $JOB --edl edl.json --check
uv run python tools/assemble.py --job $JOB --edl edl.json --output final_raw.mp4
uv run python tools/compose_render.py --job $JOB --mode render --resolution 720p \
  --caption-preset editorial --caption_break sentence --caption_vertical_anchor 0.82 \
  --broll-inserts '[{"clip":"broll/seam_journal_clip.mp4","start":14.8,"end":19.0},{"clip":"broll/seam_bust_clip.mp4","start":29.7,"end":34.0}]' \
  --allow-stub-overlays "authority-host narrator: captions-only, no hook/URL/lower-third by design"
# render consumes final_raw.mp4 automatically; --broll-inserts composites the
# seam cutaways while preserving its mixed audio. → final.mp4 (720×1280, ~68s)
```
*(If a tenant wants no seam B-roll, drop `--broll-inserts` for a captions-only
spine.)*
**(c) Input:** the lip-sync spine (B4), seam clips (B5), bed (B6), captions.
**(d) Why:** `assemble` deterministically creates the timed spine and audio mix;
the render then lays captions + cutaways onto that already-mixed spine.
**(e) Placement craft** (`skills/evaluation.md` §4a): `preflight.py --job $JOB` catches
caption-band / face collisions for declared overlays before the render. If you suspect a
placement problem afterwards, `verify_output --mode render --input final.mp4
--sample-count 6 --strip` shows the frames.

## B8. Finish

The rendered `final.mp4` is a complete draft: show it and return to the user
([Finishing a render](README.md#finishing-a-render)). The craft to build in: the
speaking track stays in lip sync and intelligible, caption wording and proper names
are right, and the music sits under the voice.

---

## Output
`jobs/$JOB/final.mp4` — a ~68s vertical (9:16, 720×1280) fireside-narrator reel:
the **locked** host bed lip-synced (fal sync-3) to a fresh VO from the **locked**
voice, sentence captions, a sourced ambience bed held steady under the voice, and seam B-roll cutaways
over the lip-sync stitch points. The narrator (face + voice) is reused next
episode; only B1–B8 re-run.

## Asset map (worked example — the rebuild)
- locked bed: the channel store → `<host_bed>.mp4`
- locked voice: `voice.json` → `<LOCKED_VOICE_ID>` (the channel's locked narrator voice; real value in the tenant's pack COMMITMENTS)
- episode VO: `jobs/$JOB/tts/narration.stretched.mp3`
- lip-sync spine: `jobs/$JOB/lipsync/host_lipsynced.mp4`
- seam B-roll: `jobs/$JOB/images/{seam_journal,seam_bust,seam_embers}.png` + `jobs/$JOB/broll/seam_journal_clip.mp4`
- ambience bed: `jobs/$JOB/footage/fireplace_bed.*`
- final: `jobs/$JOB/final.mp4`

## Swap points (what changes between tenants)
- **Voice register** — re-design once in A2 from the channel's casting brief (`skills/voice.md`).
- **Visual register / art style** — the locked still set in B5 (`skills/art_styles.md`).
- **Passage + audio bed** — the only true PER-EPISODE inputs (B1, B6).
Everything else (the locked face + voice_id + bed) is built once in Phase A.

## Gotchas
- **NO densify** on this channel — the slow ~155 WPM weighted delivery is the
  product; densify is the 215–220 WPM punchy path (wrong register).
- **Word budget ≤ ~177** so the VO lands under the bed length, or the lip-sync
  starves for frames.
- **No legible-text props** in any avatar/B-roll still (garbles → AI-tell).
- **`check_script --method lipsync`**, never the default `seedance` method — the
  narrator bed runs no Seedance, so the Seedance gate doesn't apply.
- **Lip-sync is always fal sync-3** via `lipsync_footage long`; `--max-seg 50`
  because sync models fail past ~60s. Cut seam B-roll over the resulting stitch
  points (B5 → B7 `--broll-inserts`).
