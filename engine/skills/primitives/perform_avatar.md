# perform_avatar — render the avatar speaking

Feeds cast stills + VO audio + per-chunk motion prompts to Seedance and produces
talking-head `chunk_*.mp4` files. This is the execution engine of the idea-to-avatar
pipeline: it does not design the character (→ `cast_avatar`) or write the script
(→ `check_script`); it renders it. Folds in `seedance.py` (102 calls, 15 sessions —
§1 of `_archaeology/super_tools.md`). Job-driven only: the job directory must already
contain avatar reference PNGs (`refs/`) and chunked VO audio before this runs.

```
perform_avatar --job <job> --chunk <N> [--skip-preflight]
               [--resolution 720p|1080p] [--motion-prompt "..."]
```

`--job` is **always required** (MEMORY: concurrent jobs clobber `.current_job`; tool
missing `--job` caused ERR in session `55444f0a`). `--chunk N` targets a single
chunk; omit to run all chunks in sequence. `--chunk N` on an existing chunk replaces
`chunk_NN.mp4` with one payment; the old take moves to
`<job>/previous_takes/<UTC time>/chunks/` (never deleted). If a run is interrupted after
paying with durable recovery enabled, retry once the app has saved the result: it publishes
the saved chunk without paying again, even if its reference URL or prompt changed. The tool
says when it used earlier inputs; run again after publication to buy the changed take.
For a full sequential run, explicitly regenerate each affected chunk with `--chunk N`
before stitching if you want the changed inputs; a full re-run skips existing chunks.
`--skip-preflight` bypasses the
`script_preflight.py` gate — use only for re-renders of a chunk whose audio is
already locked. `--resolution` defaults to **720p** (MEMORY: `feedback_seedance_720p_default.md`
— 1080p is hardcoded at `seedance.py ~L226`; only escalate when the user explicitly
requests it). `--motion-prompt` overrides the per-chunk prompt baked into `script.json`.

---

## Contract

- **purpose:** Render each script chunk as a talking-head video clip using the
  Seedance image-to-video engine: reference PNG → animated face + synced VO audio →
  `chunk_N.mp4`.

- **use_when:**
  - Avatar reference PNGs are locked (i.e., `cast_avatar` has completed and approved).
  - VO audio + word-timed transcript are present in the job directory.
  - `check_script` has passed (WPM within budget, contractions in place — MEMORY:
    `feedback_contractions_in_scripts.md`).

- **do_not_use_when:**
  - The character sheet doesn't exist yet (→ `cast_avatar` first).
  - You want free-form motion from an arbitrary still (→ `mint_video --mode insert`
    or `--mode keyframe`).
  - The footage is a real recorded speaker (→ `lipsync_footage`).
  - Generating a reaction-clip / motion-transfer person swap (→ `mint_video --mode genjutsu`).

- **inputs:**
  - `<job>/refs/` — avatar reference PNGs produced by `cast_avatar`. **Key
    consistency is load-bearing**: the `image_ref` key must be identical across all
    chunks or Seedance drifts to a different face on each render (rage documented in
    session `4a016c4a`).
  - `<job>/audio/chunk_N.mp3` — VO audio per chunk (from `synth_voice`).
  - `<job>/script.json` — chunk list with `motion_prompt` per chunk and the locked
    `image_ref` key.

- **success_check:**
  - Frame-extract each `chunk_N.mp4` → Read: face identity matches the reference PNG.
  - Audio sync: speech onset aligns with mouth movement.
  - No anatomy failure on hand-near-phone beats (MEMORY: `seedance.py` hands-on-phone
    anatomy is unreliable — avoid that pose in motion prompts; regen if present).
  - All chunks rendered before handing to `compose_render`.

- **backend:** Seedance (BytePlus). Upload URLs have a **24-hour TTL** — if a render
  job was queued and the URL expired, re-upload the reference PNG and resubmit; do not
  retry on the stale URL.

- **fallback:**
  - Face drift: confirm `image_ref` key is identical in every chunk entry in
    `script.json`; re-render the drifted chunk.
  - Anatomy failure (hands, phone): revise `motion_prompt` to remove the offending
    gesture; regen at 720p.
  - Seedance API error: check BytePlus status; re-queue with `--chunk N` after
    confirming the reference URL is still live (< 24h).
  - Seedance likeness refusal (`content_policy_violation` on a photoreal face):
    wait for the gateway's final result without announcing internal face fallback
    or submitting another operation. Qualification and recovery requirements:
    [avatar-speaker](../../workflows/avatar-speaker.md#if-seedance-refuses-the-face).
    Only if the gateway job ultimately fails, use the following alternative.
    Seedance's own moderation, not VideoClaw's; rewording does not help. Make the
    chunk with Gemini Omni image-to-video (the app's `call_model` with
    `google-gemini-omni-flash-image-to-video`, `image_url` = the chunk's still) and
    lipsync it; the tool prints the inputs
    ([avatar-speaker](../../workflows/avatar-speaker.md#if-seedance-refuses-the-face)).
    A chunk stopped by the app's spending settings is reported separately, not as
    a refusal.

- **evidence:** `seedance.py` — 102 calls across 15 sessions (§1, `super_tools.md`).
  Image-ref key inconsistency causing face-per-chunk drift: session `4a016c4a`.
  Missing `--job` causing ERR: session `55444f0a`. 720p default MEMORY rule:
  `feedback_seedance_720p_default.md`.

---

## NOT this tool

- **`cast_avatar`** — generates and locks the avatar character sheet (reference PNGs).
  `perform_avatar` consumes those outputs; it does not create them.
- **`mint_video --mode insert` / `--mode keyframe`** — general B-roll motion from
  arbitrary stills; not job-driven, not avatar-specific.
- **`mint_video --mode genjutsu`** — every person swap: keep a real clip's motion, camera
  and cuts and replace its people from reference images (Higgsfield through the gateway).
  Use when you have a clip and want a different identity performing it, not when
  generating fresh avatar speech from a script.
- **`lipsync_footage`** — the real-footage performer path (recorded A-roll + sync-3
  lipsync). Use when the speaker is a real person, not a synthetic avatar.
