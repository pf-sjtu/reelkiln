# cast_avatar — mint the synthetic performer's identity sheet

One tool, job-scoped. Generates a front + profile character-sheet of reference PNGs for a
synthetic performer, locking face, look, and accent so every downstream Seedance chunk shows the
same identity. Folds in `generate_avatar.py` (61 calls, 14 sessions — the only tool that has ever
done this job). Backend: Seedream 5 Lite through the gateway on Fal, with
`return_byteplus_urls=True`. Those trusted BytePlus URLs avoid the
content-moderation rejections that direct real-face uploads can trigger.
Outputs live in `<job_dir>/avatar/` and become the `image_ref` inputs for every
`perform_avatar` run.

```
cast_avatar --job <job> --role <role> \
            [--regen-front] [--regen-profile] \
            [--accent "American"|"British"|...] \
            [--character-sheet <json>]
```

`--job` is **always required** — omitting it caused the first-call ERR in session `55444f0a`
(MEMORY: always pass `--job`; `job.py` no longer falls back to `.current_job`).
`--role` is **required** and logged as `usage_role`.

---

## `generate` — produce (or regenerate) the character sheet

- **purpose:** generate the front-facing reference still (`avatar_front.png`) and the profile
  reference still (`avatar_profile.png`) that lock the performer's identity across all
  `perform_avatar` chunks.
- **use_when:** starting a new avatar job (no stills exist yet), or when the existing stills have
  drifted out of spec and need a targeted regen (use `--regen-front` or `--regen-profile` to
  re-run one angle without touching the other).
- **do_not_use_when:** the character-sheet stills already exist and are approved — proceed directly
  to `perform_avatar`. Do not re-cast just because a single chunk drifted; that is a
  `perform_avatar` re-run problem.
- **inputs:**
  - `--job <job>` (required)
  - `--character-sheet <json>` — visual spec: archetype, wardrobe and lighting. The tool stores
    Seedream's returned BytePlus URLs; do not replace them with direct-upload real-face files.
  - `--accent` — **required in the character sheet** (MEMORY: lock accent in `seedance_anchor_description`
    so voice doesn't drift across Seedance chunks; e.g. `"American"`, `"British"`)
  - `--regen-front` / `--regen-profile` — regenerate one angle only; leave the other untouched.
    The new still replaces `avatar_<angle>.png` (one payment); the old one moves to
    `<job>/previous_takes/<UTC time>/avatar/` — never deleted, move it back to restore it. An
    expired 24 h BytePlus URL is refreshed the same way. If a run is interrupted after paying,
    retry once the app has saved the result with durable recovery enabled: it publishes the
    saved still and its still-live URL without paying again, even if the prompt changed.
    The tool reports earlier inputs; run again after publication to buy the changed take.
    An expired saved URL requires a fresh paid refresh; its image is retained.
- **success_check:**
  - Read both output PNGs inline in chat — **always render generated images inline** (MEMORY:
    never just point at the path)
  - Face consistent across front and profile; no AI-tells (no legible text on props — books,
    diplomas, labeled bottles render as garbled text and are an instant AI-tell; use shape-
    credibility props instead; MEMORY: avatar backgrounds — no legible-text props)
  - Accent noted in the approved character sheet before any `perform_avatar` run begins
- **backend:** Seedream 5 Lite via the gateway/Fal; text-to-image output with
  `return_byteplus_urls=True` supplies the trusted Seedance reference
- **fallback:** ~3 regens are routine for character drift or framing issues (evidenced across 14
  sessions of `generate_avatar.py`); use `--regen-front` / `--regen-profile` for targeted fixes
  rather than re-running the full sheet. If moderation blocks a reference, confirm it is served
  from BytePlus (not a direct file upload or a real-face photo URL).
- **evidence:** `generate_avatar.py` — 61 calls, 14 sessions (`super_tools.md` §1); first-call
  `--job` ERR documented in session `55444f0a`; MEMORY rules: `feedback_lock_accent_in_character_sheet.md`,
  `feedback_avatar_no_text_props.md`, `feedback_always_show_image.md`

---

## NOT this tool

- **`perform_avatar`** — renders the avatar *speaking*: feeds the cast stills + VO audio + per-chunk
  motion prompts to Seedance. `cast_avatar` is casting; `perform_avatar` is performance. The
  identity sheet from `cast_avatar` is the required input to `perform_avatar`.
- **`mint_image --role portrait`** — a reference-conditioned still of a real or already-established
  face (the free image primitive). `cast_avatar` is job-scoped, BytePlus-backed, and produces the
  canonical character-sheet outputs that the rest of the avatar pipeline depends on — it is not a
  free `mint_image` call.
