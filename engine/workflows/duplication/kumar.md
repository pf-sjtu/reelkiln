# duplication/kumar — the "Kumar debut" format (bespoke, results-first)

> **This is a from-scratch RECREATION, not a face-swap.** The reference is a fixed
> template — a 6-beat script skeleton, two registers (desk talking-head + studio
> silhouette b-roll), and two signature motifs (red display words behind the head;
> a "[NAME]'S DEBUT" bookend). We generate the **user** into that skeleton with **their**
> angle, **their** voice, **their** face. Nothing from the source video ships. The only
> thing we invent — and the only thing that matters — is **the user's script angle.**

**Reference:** `https://www.instagram.com/reel/DZN5Njzo-Yh/` — deadpan "message to my
enemies" skit: a turtleneck talking-head at a desk, intercut with high-contrast studio
**silhouette** b-roll, giant **red Didone words** stamped behind the head, a supporting
character who vouches at the end, bookended on a hero poster. **~26s · 1080×1920 · 16 shots.**

---

## Triggers — surface this recipe, then CONFIRM before doing anything

The moment a session matches a trigger, use this recipe. Ask the line below only
when the reference is genuinely ambiguous. (The table in [`README.md`](README.md) is the router
index; this is the recipe's own copy.)

- **aliases:** "Kumar", "the Kumar method", "Kumar debut", "Indian accountant guy", "the
  deadpan accountant / message-to-my-enemies skit", or a description (turtleneck
  talking-head, red words behind the head, a friend vouches at the end).
- **URL:** any `instagram.com` URL containing the shortcode **`DZN5Njzo-Yh`**.
- **optional clarification:** *"Do you mean the Kumar 'debut' reel — the
  turtleneck guy with the red words behind his head? I have a bespoke method for it. Want
  me to build you one?"* On a clear match → follow this file. Otherwise → generic
  [`trend-duplication`](../trend-duplication.md).

---

## Before you start — the character

A recreation only works if every shot is unmistakably the user, so settle identity
**first** — right after they say yes, before the script. Check whether they already have a
character; if not, offer the choice:

- **A character videoclaw remembers** — build a reusable character now; it's saved and
  pulled into every future video they make.
- **A one-off** — just for this video, from a clear photo or a quick build, not saved.

Their call. Either way you come out with identity references that feed the stills in
Step 3. Don't generate anything until you have them.

---

## Step 1 — the angle + the script (this is the whole creative job)

Everything else is mechanical. Get this right **with the user** before generating a
single frame.

**Ask the user two things:** (1) what they do / who they are, (2) who their "enemy" is —
the group the video is a message to. Then write their 6 beats to the **exact rhetorical
shape** below. Keep it terse and deadpan — the format is dry on purpose.

| Beat | Shape | Original (paraphrase) | Example (hypothetical) |
|---|---|---|---|
| **Challenge** | "This is a message to all `<enemy>`." | "…to all finance bros." | "This is a message to all AI gurus." |
| **Credential** | "My name is `<name>`." → "I'm a/an `<role>`." | "…Kumar." / "…retired accountant." | "My name is Joseph." / "I'm a software engineer." |
| **Mission** | "And I'm going to `<threat>` by `<method>`." | "…steal your jobs by becoming the biggest accounting influencer." | "…make your faceless AI channels obsolete — by actually building the thing, on camera." |
| **Montage** | wordless ~7s | — | — |
| **Vouch** | supporting character endorses them | wife: "…please follow him." | friend: "He's been building this for months. Just follow him." |
| **Bookend** | "[NAME]'S DEBUT" poster | "KUMAR'S DEBUT" | "JOSEPH'S DEBUT" |

> The right column is a **hypothetical** — a software engineer named Joseph — shown only to
> illustrate the shape. It is not a real user; swap in whoever you're actually building for.

**Supporting character (Vouch beat):** ask if the user has an idea for who vouches and
what they say; **suggest one if they don't.** That character is a separate generated
person and speaks in a **generated voice chosen by gender** (`synth_voice --mode tts`),
never the user's voice.

**The user's VO:** strongly prefer the user **records their own voice** for the talking
beats (Challenge / Credential / Mission) — it's the single biggest quality lever. If they
won't, fall back to a generated voice, but **tell them the result will be noticeably
worse.** Get the VO **early** — every talking section's length is built from it (Step 2).

---

## Step 2 — timing: structure from the reference, length from the VO

> ‼️ **Each talking section MUST be exactly as long as its VO line.** The reference sets
> the *structure* — shot order, the two registers, which beats talk — but it does **not**
> set your durations. Measure the user's recorded VO; each
> talking beat's window = that line's spoken length. The silent studio/montage b-roll fills
> between them. Build the whole timeline (and the music bed) to **your** VO — never to the
> original's frame timings.

Decode the reference for the structure with the canonical high-quality path.
This produces frame-accurate cuts, a word-level transcript, deterministic **5fps
timeline cards**, and then makes **one** Gemini interpretation call across the
whole timeline. Do not launch this command more than once; wait for the single
`breakdown/.../breakdown.json` output it prints.

```
: "${VIDEOCLAW_JOBS_DIR:?set by the Videoclaw app}"
mkdir -p "$VIDEOCLAW_JOBS_DIR/<job>/reference"
uv run python tools/pull_video.py --job <job> --mode pull \
  --url "https://www.instagram.com/reel/DZN5Njzo-Yh/" \
  --output "$VIDEOCLAW_JOBS_DIR/<job>/reference/kumar.mp4"
```
If the user asks what the timeline decode will cost, obtain a side-effect-free
gateway quote for this exact operation. Quoting is optional and does not
authorize or delay the operation. Then run:
```bash
uv run python tools/breakdown_reference.py --job <job> \
  --video reference/kumar.mp4 \
  --transcribe --transition-frames \
  --vision-mode timeline
```

Read every `breakdown/<stem>/timeline/*.png` card plus
`timeline_analysis.json` before writing the format lock. Never replace this with
ad-hoc frame sampling or expose polling/output-path mechanics in user chat.

The 16-shot skeleton (the `in–out` column is the *reference's* timing — a starting
proportion; your talking sections flex to the VO):

| # | (ref) in–out | register | VO? | red word behind head |
|---|---|---|---|---|
| 1 | 0.00–2.27 | DESK talking | Challenge | intro sans, lower-mid (not masked) |
| 2 | 2.27–3.17 | STUDIO silhouette | — | — |
| 3 | 3.17–4.07 | DESK talking | Credential (name) | **`<NAME>`** |
| 4 | 4.07–4.97 | STUDIO ecu | — | — |
| 5 | 4.97–5.87 | DESK talking | Credential (role) | **`<ROLE>`** |
| 6 | 5.87–6.77 | STUDIO silhouette | — | — |
| 7 | 6.77–11.87 | DESK talking | Mission | **power words**, one per emphasis beat |
| 8–9 | 11.87–13.73 | STUDIO montage | — | — |
| 10 | 13.73–15.50 | SPLIT (face ecu / hand-on-device / prop) | — | — |
| 11–14 | 15.50–19.07 | STUDIO montage (poses) | — | — |
| 15 | 19.07–24.50 | DESK, user + supporting char behind | Vouch | yellow caption |
| 16 | 24.50–26.63 | POSTER, full-body hero | — | **`<NAME>`'S / DEBUT** (top/bottom) |

Two registers only: **DESK** (warm office, talking to camera, lit) and **STUDIO**
(high-contrast, crushed blacks, silhouette b-roll). Outfit = **black turtleneck**.

---

## Step 3 — identity + stills

One still per distinct setup (~13: two desk framings, ~8 studio poses, the 3 split
sub-frames, the vouch two-shot, the poster), each generated from the user's identity
references:

```
uv run python tools/mint_image.py --job <job> --role portrait \
  --reference <face_ref_1> --reference <face_ref_2> --reference <face_ref_3> \
  --aspect 2:3 --name studio_pockets \
  --prompt "<the exact same person as the references, black turtleneck, POSE/FRAMING, high-contrast noir, crushed blacks, vignette, 50mm, vertical>"
```

Studio silhouettes near-black with a hard rim; desk shots warm and legible. Keep the same
turtleneck across every still.

---

## Step 4 — motion (identity references → clip)

Generate clips with Omni image-to-video from each approved composed still
(`mint_video --mode multishot` is unavailable, videoclaw#317). **Do not use `keyframe` for a photoreal person** — Seedance rejects
that shape. Keep studio motion subtle (a breath, a slow push) and desk shots
slightly more active so they can be lipsynced next.

Run the app's `search_models` for `google-gemini-omni-flash-image-to-video`, then
`call_model` with that `model_slug`, the returned `model_contract`, and this input:

- `prompt`: "One continuous photoreal studio shot: the exact person in the image stays in this approved composition; subtle breath and slow camera push, stable identity and clothing."
- `image_url`: `images/studio_pockets.png` (the approved still, relative to this video)
- `duration`: `5` (3–10 s) · `aspect_ratio`: `"9:16"`

**Run each motion call in the foreground, one call at a time** (use `--batch` where the mode
supports it; never start background or separate parallel processes). Each talking-beat clip must be **at least as
long as its VO line** (Step 2's rule); silhouette/montage clips only need to cover their
window.

---

## Step 5 — the two signature motifs

**(a) Red words behind the head (DESK talking beats 3/5/7).** This is the format's
signature. For each title shot: `sam3` a matte of the person, render the red Didone
word(s) as a full-width layer, and composite the word **UNDER** the person so it passes
behind the head. On the Mission beat (7) the words flash **one at a time, synced to the VO
word timings** (one word per emphasis beat of the line).

```
: "${VIDEOCLAW_JOBS_DIR:?set by the Videoclaw app}"
uv run python tools/sam3.py segment --job <job> \
  --video "$VIDEOCLAW_JOBS_DIR/<job>/clips/m_desk_steepled.mp4" \
  --prompt "the man in the turtleneck" --output-kind mask_only
# The handler prints the generated mask under "$VIDEOCLAW_JOBS_DIR/<job>/masks/".
# then render one timed Remotion/SVG text layer (Playfair Display Black, #ff0000,
# ~92% screen width) UNDER the person matte. Keep words as text + timing data;
# never create standalone word PNGs or use an image generator for typography.
```

Font = **Playfair Display Black / Bodoni**, color **`#ff0000`** — pixel-check against the
original's frames. Intro (beat 1) is a bold **sans** in lower-mid, **not** masked.

**(b) The bookend poster (beat 16).** Full-body hero, arms crossed, "`<NAME>`'S" top /
"DEBUT" bottom in the same red Didone. *(This replaces the original's eyes/money/shoes
3-panel — ending on a single hero poster reads cleaner.)*

---

## Step 6 — audio (one steady bed — that's it)

> The bed is simple: **one steady level, about 15 dB under the voice, the same under the
> talking beats and the no-dialogue studio montage** (JC, #321: in a skit the music is
> never cut, muted or dipped under a line, and never swells between lines). The one hard
> rule: **no source vocal may leak.**

1. Pull the original reel's audio and **stem-split** it (`score_bed.py --mode split`) to a
   clean instrumental — use **only** the wordless montage stretch (no speech, no bleed).
2. Lay it as one steady bed under the whole cut, about 15 dB under the user's VO
   (`score_bed --bed-under-voice-db 15`, or `assemble` with `"under_voice_db": 15`), the
   same level under the talking beats and the montage. `amix …:normalize=0` so nothing
   pumps.
3. Talking beats: lipsync the desk clips to the user's real VO —
   `lipsync_footage.py long --job <job> --video <clip> --audio <vo>`. QA every beat for lip
   drift; regenerate any beat that drifts badly.
4. The supporting-character line (Vouch beat) uses the generated voice from Step 1.

**Publishing note:** a bed from the original instrumental is **PRIVATE / dev only** —
before any public post, replace it with a licensed or generated (`score_bed --mode
generate`) bed.

---

## Step 7 — assemble

Cut every shot to its window (talking beats = VO length, Step 2), normalize each to
1080×1920 / 30fps, concat, then mux the audio. See
`$VIDEOCLAW_JOBS_DIR/jc_kumar_debut/assemble.py` +
`edl.json` for the reference EDL. Grade the whole thing high-contrast: crushed blacks +
vignette.

---

## Step 8 — Reference comparison and finish

The pixel-perfect check the earlier duplication runs lacked. Render both and **look**:

```
uv run python tools/render_timeline_strip.py --job <job> --stack \
  --ref <ref>.mp4 --ours output/<final>.mp4 \
  --ref-cuts ref_cuts.json --ours-cuts ours_cuts.json
# + a synced side-by-side: ffmpeg hstack ref | ours, matched height, -shortest
```

**Pass criteria (all four):**
1. **Section lengths** — every talking section equals its VO line, and the overall cut
   rhythm reads like the reference.
2. **Power words** — legible, red, correctly *behind* the head, flashing on the VO word.
3. **Bed** — one steady level about 15 dB under the voice, the same under the talking
   beats and the montage; nothing pumps; no source vocal leak.
4. **Vouch beat** — the supporting character reads natural; caption pacing ≤ ~0.5s drift.

Record any differences for the user and present the completed video as a draft
([Finishing a render](../README.md#finishing-a-render)) with those differences.
Only a new user edit request starts another build turn; no autonomous fidelity loop.

---

## Production shape

A full build is ~16 stills + ~16 motion clips + ~5 lipsync beats + 3 mattes + stem-split
+ bed. Motion and lipsync dominate wall-clock; batch them where the tool supports `--batch` and
run every call in the foreground. Keep the user's
angle tight and the turtleneck + grade consistent, and the format does the rest.
