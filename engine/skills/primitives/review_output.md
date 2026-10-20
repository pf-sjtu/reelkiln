# review_output — post-render editorial review, role-aware

Looks at a finished video and judges whether each beat's footage fulfilled its declared
`usage_role` (logged by `mint_image --role` / `mint_video --mode` at generation time).
Flags AI-tells, usable-but-wrong placements, cheap `insert` where a `keyframe` hero was
needed, and slop. Style/editorial findings are advisory. Exact delivery defects
(clipped/obscured people, required captions missing or over faces, and platform
red-zone collisions) return a blocking `CONTENT_FAIL`; unavailable detectors return
`QA_UNAVAILABLE`.
Built on `gemini_video.py` (85 calls, 14 sessions) as the eyes layer, plus a new unified
judge that maps Gemini's mechanical observations against the declared role per beat.
Covers: `gemini_video.py` (per-chunk review) + `score.py` (DEPRECATED — explicitly
dropped by user in session 371a0e39: "right now it isn't right and it's not adding
anything"). MEMORY: Gemini is eyes, not taste — its quality verdicts never override
the human call (see `skills/evaluation.md`, the governing law);
this tool exists precisely to use Gemini for what it is reliable at (mechanical description)
while a role-aware judge (not Gemini's score) does the editorial mapping.

```
review_output --job <job> --mode <mode> [--video <mp4>] [--beat <n>] [--role-log <jsonl>]
```

`--mode` is **required** and logged as `usage_role`. `--job` is always required
(concurrent jobs clobber any implicit current-job state). `--role-log`
defaults to the job's generation log (`run.log.jsonl`) where every `mint_*` call records
its `--role`/`--mode`; if not present, review runs without role-matching (degraded mode).

For caption-heavy edits, `promise.json` may name a job-contained, caption-free
`delivery.face_source` with identical geometry and duration. Deterministic face geometry
is read from that file while the final captioned bytes remain the reviewed deliverable;
both hashes are recorded. Time-bounded `delivery.composition_exceptions` support
intentional off-centre and multi-panel shots without weakening clipping, face-obscuring,
caption-face, or red-zone failures.

---

## `full` — whole-video editorial sweep

- **purpose:** review every beat in the finished render against its declared `usage_role`;
  produce a per-beat verdict table (role / observed / verdict / AI-tell flags).
- **use_when:** the human asks for an anti-slop pass on a complete render, or standalone
  methodology work. A finished render is a complete draft and never waits on it.
- **do_not_use_when:** the video hasn't been rendered yet (→ `check_layout`); you only want
  mechanical integrity (broken frames, no audio) → `verify_output`.
- **inputs:** the final rendered mp4 (defaults to `<job_dir>/output/final.mp4`); the job's
  `run.log.jsonl` for role context; optionally a `beats.json` if beat boundaries are known.
- **outputs:** a per-beat editorial table, printed to stdout + appended to
  `<job_dir>/review_output.md`. Columns: beat / declared_role / observed_description /
  verdict (`on-role` | `usable-but-wrong` | `slop` | `ai-tell`) / notes.
- **success_check:** every beat has a verdict. At least one `on-role` or `usable-but-wrong`
  beat; any `slop` or `ai-tell` verdict surfaces a recommended action (regen with what role).
- **backend:** `gemini_video.py` samples frames + returns mechanical descriptions; the judge
  maps description → role compliance. Gemini's internal quality score is **discarded** —
  only its descriptive observations are used (MEMORY: `feedback_gemini_no_taste.md`).
- **fallback:** if the integrated reviewer or deterministic delivery detector cannot
  complete its own bounded retry, return `QA_UNAVAILABLE`. Manual frame strips are
  diagnostic and cannot create a PASS receipt.
- **evidence:** `gemini_video.py` — 85 calls, 14 sessions. `score.py` deprecated 371a0e39
  (wrong verdicts, zero utility). The gap between "is it broken?" (`verify_output`) and "is
  it good?" (`review_output`) was the explicit design motivation in CANONICAL_TOOLS.md.

---

## `beat` — single-beat spot check

- **purpose:** focus review on one specific beat (by index or timestamp range) rather than
  the whole video; fast re-check after a targeted regen.
- **use_when:** a single beat was flagged `slop` / `ai-tell` in a prior `full` pass and was
  re-generated; confirm the replacement is on-role before re-rendering the full video.
- **do_not_use_when:** you haven't run `full` yet and don't know which beats are suspect.
- **inputs:** `--beat <n>` (beat index from `beats.json`) or `--ts-start / --ts-end`; the
  regenerated clip; declared role (pulled from role-log or passed as `--declared-role`).
- **outputs:** single-beat verdict + diff note if the prior verdict is known.
- **backend:** same as `full` — `gemini_video.py` on the clip window; role-judge on the
  description.
- **fallback:** frame-extract → Read on the beat window.
- **evidence:** `verify_render.py` (78 calls, 11 sessions) established the frame-extract
  QA loop that `beat` mode extends editorially; `gemini_video.py` was already invoked
  per-chunk in practice — `beat` mode formalizes that pattern.

---

## NOT this tool

- **`verify_output`** — the mechanical "is it broken?" check: overlays rendered, no black
  frames, audio present. `review_output` adds delivery-safety findings while leaving taste
  and editorial style to the agent/human.
- **`check_layout`** — pre-render check (face collision, overlay anchors, caption luma).
  Runs *before* `compose_render`; `review_output` runs *after*.
- **`analyze_reference`** — reads an *incoming* reference/outlier video to extract staging
  and format before production begins. `review_output` reads the *finished job output*.
- **`gemini_video.py` directly** — calling it raw returns a quality score and an
  unstructured description; the score must be discarded (MEMORY: Gemini is eyes, not taste)
  and the description has no role context to map against. `review_output` is the correct
  wrapper: it supplies the role-log, discards the score, and runs the judge layer.
- **`make_cover.py`** — cover-frame selection. Not a quality review; uses Gemini for frame
  picking only.
