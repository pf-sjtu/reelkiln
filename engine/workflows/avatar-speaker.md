# avatar-speaker — explicitly requested synthetic talking-head

Use this recipe only when the user asks for a fully synthetic endorser. For a real
person's new dialogue, use the [talking-head default](README.md#talking-head-default),
including its fallback and cost tradeoffs. The historical native-audio method below
does not prove the current provider route is healthy; backend #149 owns that route.

A synthetic endorser delivers one insight to camera as a vertical (9:16) talking-head
reel. Seedance is **native-audio**: `perform_avatar` makes the chunks *speak* — there
is no separate VO baked into the video. `synth_voice --mode transcribe` is the
stitch + Scribe-v2 transcription step (not a pre-generated voice fed into Seedance).
ElevenLabs is transcription-only on this path.

**Wait for the gateway's final result without narrating internal face fallback.**
After final failure, offer Gemini Omni from the same still, then voice + lipsync; see
[If Seedance refuses the face](#if-seedance-refuses-the-face).

All tools run from repo root `/Users/chin/projects/videoclaw` as
`uv run python tools/<tool>.py` and take **`--job <id>` explicitly** (concurrent jobs
clobber `.current_job`). Lip-sync, where it ever applies, is always fal sync-3 via
`lipsync_footage` — but the canonical avatar path needs none, because Seedance speaks
natively.

Shared skills do the heavy lifting; this recipe references them, never repeats them:
- `skills/evaluation.md` — Gemini is EYES not TASTE; the per-asset eval rungs.
- `skills/voice.md` — voice selection, delivery direction and measured pacing.
- `skills/seedance_prompting_guide.md` — the `[Image1]` + quoted-dialogue rules.
- `skills/art_styles.md`, `skills/broll_styles.md` — only if you cut to an insert.

Worked example backing every command below:
`_rebuilds/avatar_speaker/` — a 31s book-insight reel for an editorial book-quote
channel that shipped after the eval loop closed three real defects. That rebuild is
the proven path, not the only one; write your own brand into the `[BRAND]` steps.

---

## Input

| Input | Where it comes from |
|---|---|
| **The insight** (the one thing said) | The tenant's content brief / log line. The insight IS the whole video — perfect it before any pixel renders. |
| **Brand voice + register** | Tenant style sheet → delivery direction and target pace (`skills/voice.md`). The worked example uses `warm-confiding` × 170 WPM intimate; choose the actual register from the current brief. |
| **Brand overlay pack** | Tenant's locked overlay look (badge, citation card, end-card). Unstated → persistent corner badge + lower-left citation + tail end-card. |
| **Host identity** (optional) | A locked `_productions/<brand>_speaker/blueprint/` (character_sheet.json + avatar_front.png) to reuse, OR cast fresh in Step 2. |

## Output

`<job>/output/final.mp4` — a ~30–45s vertical (9:16) talking-head reel: the synthetic
endorser delivering one insight, brand captions + citation card + end-card, every
beat's mechanical observations empty.

---

## Steps

### Step 0 — One-time environment [GENERIC]

- **(a) Generate:** an installed Remotion toolchain + stubbed orphan caption JSONs.
- **(b) Command:**
  ```bash
  cd /Users/chin/projects/videoclaw/remotion && npm install
  cd /Users/chin/projects/videoclaw
  grep -rhoE 'from "\.\./public/[^"]+\.json"' remotion/src/ \
    | sed -E 's/from "\.\.\///; s/"$//' | sort -u \
    | while read rel; do f="remotion/$rel"; mkdir -p "$(dirname "$f")"; \
        [ -f "$f" ] || printf '{"chunks": []}' > "$f"; done
  ```
- **(c) Source:** the shared `remotion/src` tree.
- **(d) Why:** the bundler compiles ALL src files; one missing static import fails
  `compose_render` for EVERY job. Stubbing unblocks renders.
- **EVAL:** none (setup). Skip if `remotion/node_modules` already exists and no stale
  one-off compositions statically import missing per-job JSONs.

### Step 1 — Write the insight [BRAND: voice]

- **(a) Generate:** `<job>/script.json` — 3 long talking-head chunks. Each chunk =
  `dialogue` (the spoken line, **contractions throughout** — Seedance reads literally)
  + a timeline-segmented `seedance_prompt` that quotes the first words of every spoken
  sentence verbatim and ends with the `[Image1]` token. **Proper nouns are spelled
  CORRECTLY in `dialogue`**; any phonetic respell goes in a separate
  `pronunciation_notes` field for the operator only (check_script BLOCKS a respell that
  leaks into spoken text — the "Cialdini → Sil-ee-ah-bee" defect).
- **(b) Command:** authored by hand against `skills/seedance_prompting_guide.md` and
  the tenant voice corpus. No generation tool — the script is the human's craft input.
- **(c) Source:** the insight + the brand voice/register (Input table).
- **(d) Why:** the insight is the entire video; it's the one thing worth perfecting
  before anything stochastic runs.
- **EVAL — `check_script` (the pre-generation gate, before any credits):**
  ```bash
  # Build a self-grounded reference analysis when there's no external reference:
  #   <job>/reference/analysis__self.json — one entry per spoken sentence, with
  #   story_arc/shot/overlays/audio as LISTS OF DICTS (a bare string crashes the report).
  uv run python tools/check_script.py --job $JOB --method seedance --skip-llm
  ```
  `--method seedance` applies the full Seedance gate: `[Image1]` present in every
  `seedance_prompt`, every dialogue sentence quoted in the prompt, and the proper-noun
  phonetic-respell guard. **Pass criteria: 0 BLOCKING, no
  `phonetic_respell_in_dialogue`.** WPM-drift SHOULD_FIX warnings are advisory — at the
  warm register's 1.10× they stay legal. (Rebuild: 0 BLOCKING, 0 respell violations,
  a tricky proper noun in the script spelled correctly in dialogue.)

### Step 2 — Cast the endorser [BRAND: host look]

- **(a) Generate:** `<job>/avatar/avatar_front.png` + `character_sheet.json` — a
  credible, distinctive host with a locked accent and a credibility-prop background.
- **(b) Command:**
  ```bash
  uv run python tools/cast_avatar.py --job $JOB --role endorser --accent American --regen-front
  ```
  `--accent` writes the spoken accent into the sheet so the voice doesn't drift across
  Seedance chunks. `--regen-front` re-uploads → a **fresh 24h BytePlus URL**
  (`perform_avatar` needs a LIVE url for image conditioning; the cached one expires in
  24h). To reuse a locked brand host instead, `cp` its blueprint sheet + front png into
  `<job>/avatar/` and run with `--regen-front` only to refresh the URL.
- **(c) Source:** the brand host look + the accent from the register decision (Step 1).
- **(d) Why:** a consistent face + locked accent across every chunk is what makes the
  avatar read as a real endorser, not a deepfake. **No legible-text props** (books,
  diplomas, labeled bottles) — they render garbled and are an instant AI-tell; use
  shape-credibility props.
- **EVAL — the image gets EYES, no Gemini (a still has no motion/audio,
  `skills/evaluation.md` §1):**
  1. `Read jobs/$JOB/avatar/avatar_front.png` **inline** — mandatory; evaluate the
     actual pixels, never just a path.
  2. Eyeball against `skills/avatar_prompting_guide.md` §10: anti-uncanny (named
     imperfection actually present? plastic-skin avoided?), IVP fit, 3+ named props,
     **zero legible-text props**.
  3. Select the strongest grounded passing host by default, or re-roll a mechanical miss
     by editing the Seedream prompt. Surface options for optional casting feedback; pause
     only when the user explicitly requested selection or all variants materially miss.
     Any real-person likeness still requires explicit consent. No score, no Gemini verdict.

### Step 3 — Perform the talking-head [BRAND: framing]

- **(a) Generate:** `<job>/chunks/chunk_NN.mp4` — Seedance native-audio chunks; the
  host SPEAKS the script.
- **(b) Command:**
  ```bash
  uv run python tools/perform_avatar.py --job $JOB --role endorser --resolution 720p --skip-preflight
  ```
  720p is the repo default (cheaper + faster, indistinguishable at reel size). Escalate
  to 1080p only when the deliverable explicitly demands it.
- **(c) Source:** `character_sheet.json` (live BytePlus URL) + each chunk's
  `seedance_prompt` from Step 1.
- **(d) Why:** Seedance generates the lip-synced audio natively — this single step
  produces both the voice and the moving face.
- **EVAL — every chunk gets EYES+EARS via `gemini_video` chunk_review
  (`skills/evaluation.md` §3):**
  ```bash
  uv run python tools/gemini_video.py --job $JOB --mode chunk_review --chunk all
  ```
  Read each `chunk_review_N.json`. **Regenerate ONLY on a MECHANICAL defect:**
  `dialogue_match=divergent` (wrong words / mangled name), deformed hands/fingers,
  identity/lighting/room jump, mid-chunk dropout, lip-sync drift >~150ms. Never regen on
  taste ("flat", "soulless") — if that leaks, fix the prompt template, not the asset.
  Regen one chunk with a framing override:
  ```bash
  uv run python tools/perform_avatar.py --job $JOB --role endorser --resolution 720p \
      --chunk N --motion-prompt "<override>" --skip-preflight
  ```
  **Hand defects are the #1 regen cause** (rebuild: 6-finger hands on beats 0+1).
  Seedance ignores "hands out of frame" in a medium shot; the reliable fix is a
  genuinely TIGHT face-and-shoulders crop ("cropped below the collarbone, no
  desk/hands/arms anywhere in frame") so no hands render at all. Re-review until anatomy
  is clean. (Rebuild also caught Seedance mis-reading a tricky proper noun in the script →
  fixed by rewording the spoken line off the title collision; book still cited via the
  overlay card.)

#### If Seedance refuses the face

This section applies only after the gateway job has a final failure. For qualified
480p/720p image-reference requests, the backend tries Fal first and handles its
proven zero-charge likeness refusal internally with Higgsfield Seedance 2.5 under
the same approval and customer ceiling. Keep waiting on that same job;
do not create another paid operation or tell the user about an intermediate
provider refusal. Seeds, first-frame inputs, 1080p and sequential video references
do not qualify; their constraints must not be discarded. The app enables operation
recovery, which lets the tool omit its automatic seed. Gateway calls without recovery
retain the old seed and do not qualify. A paid take saved under either seed is
published instead of bought again.

Seedance's own moderation refuses many photoreal generated faces as a possible
likeness of a real person (`content_policy_violation`). That is Seedance's policy,
not VideoClaw's or the studio's; say so when you tell the user. Rewording the prompt
does not help. `perform_avatar` names the refused chunks and prints the Omni
`call_model` inputs below with this job's still and durations filled in. It reports each failed chunk's own cause: a
chunk stopped by the app's spending settings (`AUTHORIZATION_REQUIRED`,
`SPEND_POLICY_CHANGED`) was not refused, so report it separately.

Offer **Gemini Omni** as the recommended option; it accepts the same still. The
other options are a stylized (illustrated) presenter, or faceless voiceover + B-roll.
`mint_video --mode multishot` is unavailable (videoclaw#317); do not use it.

1. **Motion:** one talking base per chunk from the chunk's still, at least as long as
   its line, through the app's native model tools. Run `search_models` for
   `google-gemini-omni-flash-image-to-video`, then `call_model` with that
   `model_slug`, the `model_contract` it returns, and this input. Omni makes 3–10s
   per call, so make a longer chunk in equal parts and join them in order.
   ```json
   {"prompt": "The person in the image speaks to the camera, keeping the framing of the image: natural mouth and jaw movement as if talking, small head and shoulder motion, the same face, hair, clothing and background, locked camera, no hands in frame.", "image_url": "avatar/avatar_front.png", "duration": 8, "aspect_ratio": "9:16"}
   ```
2. **Voice:** the chunk's `dialogue` in one locked host voice that fits the sheet's
   accent ([`skills/voice.md`](../skills/voice.md)). It writes
   `tts/chunk_00.mp3` (or `tts/<chunk_id>.mp3`).
   ```bash
   uv run python tools/synth_voice.py --job $JOB --mode tts --voice <host-voice> --chunk 0
   ```
3. **Lipsync** the base to the line, into the chunk slot that Step 4 stitches:
   ```bash
   uv run python tools/lipsync_footage.py long --job $JOB \
     --video "<the clip call_model saved>" \
     --audio "$VIDEOCLAW_JOBS_DIR/$JOB/tts/chunk_00.mp3" \
     --output "$VIDEOCLAW_JOBS_DIR/$JOB/chunks/chunk_00.mp4"
   ```

Use one voice for the whole video. Seedance's native voice cannot be matched, so if
some chunks already came from Seedance, lipsync them to the same TTS voice too, or
make them with Omni. Omni can also return its own audio, but no run here has
proven its speech yet; check
`dialogue_match` with `chunk_review` before you rely on it. Review each chunk as
above, then continue at Step 4.

### Step 4 — Stitch + transcribe [GENERIC]

- **(a) Generate:** `<job>/final_raw.mp4` (stitched chunks) + `transcript.json`
  (word-timed PASS 1).
- **(b) Command:**
  ```bash
  uv run python tools/synth_voice.py --job $JOB --mode transcribe
  ```
- **(c) Source:** the reviewed chunks from Step 3.
- **(d) Why:** concatenates the speaking chunks and runs Scribe v2 for word-level
  timestamps — the drift-free timing source for densify + captions.
- **EVAL:** deferred to Step 5 (densify re-transcribes anyway; the meaningful audio QA
  is on the densified output).

### Step 5 — Pace (register-aware densify) [BRAND: register]

- **(a) Generate:** `<job>/final_raw.mp4` re-paced + `densify_meta.json` + a PASS-2
  `transcript.json`.
- **(b) Command — the example rates below are starting points; measure the actual take before adjusting speed:**

  | energy_register | densify `--speed` | lands ~WPM |
  |---|---|---|
  | `warm-confiding` / `earnest-vulnerable` (intimate) | `1.10` | ~210 |
  | `sharp-authoritative` / `dry-amused` / `wry-playful` (punchy default) | `1.22` | ~215–220 |

  ```bash
  uv run python tools/densify.py --job $JOB --mode normal --speed 1.10
  # silence-clip + stretch + PASS-2 re-transcribe.
  ```
  The tool default is **1.22× (punchy)** — it over-runs an intimate read to ~240 WPM,
  so a warm-confiding brand MUST pass `--speed 1.10` explicitly.
- **(c) Source:** the register decided in Step 1 + the stitched `final_raw.mp4`.
- **(d) Why:** pacing is register-dependent; a fixed rate breaks the delivery the script
  was written for.
- **EVAL — deterministic WPM + a `verify_output` audio pass (`skills/evaluation.md`
  §2):**
  ```bash
  uv run python tools/verify_output.py --job $JOB --mode audio --input final_raw.mp4
  ```
  Then **read `densify_meta.json` and report `final_wpm`** — it is the objective pacing
  metric. Confirm it sits in the register's band; confirm no clipping / dead air. (Rebuild:
  38.2s → 29.4s, **212 WPM**, 1.10× — legal for warm-confiding.)

### Step 6 — Tail-pad against outro-over-dialogue [BRAND: end-card timing]

- **(a) Generate:** `<job>/final_raw.mp4` with a frozen tail AFTER the last spoken word.
- **(b) Command:**
  ```bash
  D=jobs/$JOB
  cp $D/final_raw.mp4 $D/final_raw_nopad.mp4
  ffmpeg -y -i $D/final_raw_nopad.mp4 \
    -vf "tpad=stop_mode=clone:stop_duration=1.6" -af "apad=pad_dur=1.6" \
    -c:v libx264 -preset medium -crf 18 -c:a aac $D/final_raw.mp4
  ```
  In `overlays.tsx` (Step 7), anchor `endStart = lastWord.end + 0.25` so the end-card
  lands in the tail, never over live speech.
- **(c) Source:** the densified `final_raw.mp4` + the PASS-2 transcript's last word.
- **(d) Why:** prevents the **outro-over-dialogue** defect — without a tail the card is
  clipped to nothing; without the `lastWord.end` anchor a full-screen card covers the
  speaker mid-sentence (the inherited bug where `endStart = duration - 4.0` faded the
  card over live speech).
- **EVAL:** the end-card must land AFTER the CTA / last word (Step 9).

### Step 7 — Overlays + layout gate [BRAND: overlay pack]

- **(a) Generate:** `<job>/overlays.tsx` — persistent brand badge + citation card +
  end-card.
- **(b) Command:** authored by hand against `skills/overlay_authoring_guide.md`.
  `compose_render` refuses to render without it. **Place the citation card in a corner
  (lower-left), NOT top-center** — a tight close-up fills the upper-center with the
  forehead, so a top-center card collides with the face (covers_face defect; rebuild
  moved the citation pill off the forehead).
- **(c) Source:** the brand overlay pack + the PASS-2 transcript anchors.
- **(d) Why:** captions + citation + end-card are the brand layer; the layout gate
  catches collisions before a render is spent.
- **EVAL — `check_layout` (cheap, pre-render; `skills/evaluation.md` §4a):**
  ```bash
  uv run python tools/check_layout.py --job $JOB --role anchors    # findWord anchors resolve in transcript?
  uv run python tools/check_layout.py --job $JOB --role luma --frame <a_dark_frame.png>  # caption-safe region
  ```
  Anchors must resolve; the luma pass writes the caption-safe / auto-flip data. Note
  `check_layout` is **blind to JSX authored in overlays.tsx** — the inline-frame-Read
  ritual in Step 9a is what catches JSX placement bugs.

### Step 8 — Compose the final render [BRAND: caption style]

- **(a) Generate:** `<job>/output/final.mp4` — the composited reel.
- **(b) Command:**
  ```bash
  uv run python tools/compose_render.py --job $JOB --mode render --resolution 720p --caption_break sentence
  ```
  Captions auto-flip outline color on dark footage (`caption_luminance.json` from the
  luma pass), so a dark study background stays legible — this is what **prevents the
  dark-caption defect** by design.
- **(c) Source:** `final_raw.mp4` (Step 6) + `overlays.tsx` (Step 7) + transcript.
- **(d) Why:** burns captions + brand overlays onto the paced talking-head.
- **Craft:** the composite must carry the mixed audio and no black or frozen
  frames. If you suspect a broken frame, `verify_output --mode render` extracts
  frames to show it (the rebuild read STATUS OK, no black frames, audio present).

### Step 9 — Finish

The rendered `final.mp4` is a complete draft: show it and return to the user
([Finishing a render](README.md#finishing-a-render)). The craft to build in: the
end card lands after the last word, captions keep their contrast, speech is never
clipped, and proper names are pronounced right. Taste labels are not mechanical
defects. The historical rebuild recorded 0 brand-text flags, 0.975 caption overlap
and proper-noun pronunciation PASS after its repairs.

---

## Defect ledger (the eval loop earning its keep — from the proven rebuild)

1. **Seedance read the wrong words** — native audio mangled a tricky proper noun in
   the script → reworded the spoken line off the title collision (Step 3 chunk_review
   caught it).
2. **Deformed / 6-finger hands** in medium shots → regenerated as tight
   face-and-shoulders crops with no hands in frame (Step 3).
3. **Citation pill over the forehead** on the punch-in → moved to lower-left corner
   (Step 7).
4. **Outro-over-dialogue** (inherited pattern) → end-card anchored to
   `lastWord.end + 0.25` + a 1.6s frozen tail (Step 6).
5. **Dark-caption** → caption auto-flip on dark footage, prevented by design (Step 8).
6. **Render bundle broke** on stale one-off compositions' static imports → stubbed the
   missing caption JSONs (Step 0).
