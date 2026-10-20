# check_script — pre-generation gate for script.json

Audits `script.json` before any Seedance credits are spent. Two-phase: (1) fast
deterministic checks (`[Image1]` presence, dialogue verbatim in prompt, chunk-window
vs reference duration, reference-sentence overlap) that gate the LLM call on ERROR;
(2) per-chunk LLM audit (default `anthropic/claude-sonnet-4.6`, override via
`PREFLIGHT_MODEL`) that receives the full `seedance_prompting_guide.md` (~1400 lines),
the chunk's sentence-grounded reference events (story_arc / shot / overlays / audio),
`vision.md`, and `character_sheet.json` fresh — the main agent never needs that context
in its working window. Returns `BLOCKING / SHOULD_FIX / NICE_TO_HAVE` findings with
guide-section citations and copy-pasteable fixes; saves
`<job_dir>/script_preflight_report.md`. Folds: `script_preflight.py` (51 calls, 12
sessions — the most-called checking tool in the archaeology ledger). Friction this
cures: per-chunk WPM was not reported out of the box, forcing users to instrument it
by hand across 86dc34db (13 preflight calls) and 685a9182 (7+ edit loops). Built-in
per-chunk WPM + a friendly pacing summary are now part of the default output.

MEMORY prerequisites (apply before every invocation):
- Read `user_script_voice/PATTERNS.md` before drafting any script (MEMORY
  `feedback_user_script_voice_corpus.md`, CLAUDE.md rule 22).
- Snapshot every edit round via `snapshot_script.py` after the gate passes (same rule).

```
check_script --job <job>
             [--strict]       # block on SHOULD_FIX as well as BLOCKING
             [--skip-llm]     # Phase 1 deterministic only — no API cost
             [--quiet]        # write report file, suppress stdout
             [--analysis <path>]  # explicitly selected analysis JSON, relative to cwd
```

`--job` is **required** (per MEMORY `feedback_always_pass_job.md` — concurrent jobs
clobber `.current_job`; every tool must pass `--job` explicitly). `--skip-llm` is the
fast structural-only shortcut; use it when you want to confirm `[Image1]` / dialogue
verbatim / timing before spending OpenRouter tokens.

---

## Contract

- **purpose:** gate `script.json` before generation — catch structural errors (Phase 1)
  and prompt-guide compliance gaps (Phase 2) at the cheapest possible moment, before
  any Seedance credit is spent.
- **use_when:** after every `script.json` draft or edit round, before `perform_avatar`
  (which auto-invokes this gate and refuses to run if BLOCKING findings remain). Run
  explicitly after viralizer pass, fact-check, and seedance-prompt revision; re-run
  after every user script edit.
- **do_not_use_when:** checking layout anchors / face-caption collision (→
  `check_layout`); verifying a finished render for broken frames or audio presence (→
  `verify_output`); analysing a reference video's staging and mechanism (→
  `analyze_reference`).
- **inputs:**
  - `<job_dir>/script.json` — the artifact under audit (must exist; exit 2 if not)
  - Reference analysis is opt-in for every method, including Seedance. Use `--analysis <path>` for a user-selected reference, or persist the plan's selection as `"reference_analysis": "reference/analysis__chosen.json"` in `script.json`, relative to the job. The CLI selection takes precedence. A selected file must exist and use sentence-grounded format, otherwise exit 2. An unselected video or analysis left in `reference/` has no effect; the method alone never selects a reference. Without a selection, prompt, dialogue and pacing checks still run, but reference-fidelity checks do not.
  - `<job_dir>/vision.md` — brand strategy (Phase 2 only)
  - `<job_dir>/avatar/character_sheet.json` — continuity rules (Phase 2 only)
  - `agent/skills/seedance_prompting_guide.md` — authoritative Seedance prompt guide
    passed fresh to each per-chunk LLM call (Phase 2 only)
- **outputs:**
  - `<job_dir>/script_preflight_report.md` — full structured report (always written)
  - `<job_dir>/run/script_preflight__chunk_<idx>__response.txt` — raw LLM responses
    per chunk (Phase 2 only, for debugging)
  - structured event in `run.log.jsonl`
  - stdout console summary (suppressed with `--quiet`)
- **success_check:** exit 0 with no BLOCKING items in the report; the console line
  reads "Preflight clean. Ready for seedance.py." If SHOULD_FIX items remain, they are
  advisory — review and either fix or document deliberate divergence in
  `adaptation_notes` per chunk.
- **per-chunk WPM summary:** for every chunk with dialogue, the report surfaces (a)
  word count, (b) Seedance source window in seconds, (c) post-densify duration at the
  configured stretch factor (default 1.22×), and (d) resulting post-densify WPM vs.
  the script's `target_wpm_post_densify` field. Drift > ±5 WPM from target is flagged
  SHOULD_FIX with an `ideal_words` and `ideal_window` suggestion. This replaces the
  recurring manual instrumentation (86dc34db 13 calls, 685a9182 7+ loops).
- **severity model:**
  - `BLOCKING / ERROR` — prompt WILL fail or produce broken Seedance output (missing
    `[Image1]`, dialogue not in prompt, no overlapping reference sentences). Phase 1
    deterministic only; Phase 2 LLM findings are demoted to SHOULD_FIX by default
    unless `PREFLIGHT_TRUST_LLM_BLOCKING=1` is set.
  - `SHOULD_FIX` — degrades quality meaningfully: missing audio direction, missing
    canonical multi-camera phrase from §9, weak style anchor from §16.8, vague
    high-risk word from §6, prompt overload (>300 words), reference event dropped
    without `adaptation_notes`, chunk WPM drift > ±5 from target.
  - `NICE_TO_HAVE` — minor polish (sharper micro-action specificity, stronger lighting
    language).
- **backend:** Phase 1 = deterministic Python (regex / numeric, no API cost). Phase 2 =
  parallel per-chunk LLM calls via OpenRouter (`PREFLIGHT_MODEL` env, default
  `anthropic/claude-sonnet-4.6`, `PREFLIGHT_PARALLEL_WORKERS=5`). Total cost < $1 for
  a typical 3-5 chunk script.
- **fallback:** if `OPENROUTER_API_KEY` is absent, the tool automatically degrades to
  Phase 1 only (equivalent to `--skip-llm`) with a console warning. Phase 1 alone
  catches the hardest blockers (missing `[Image1]`, dialogue not in prompt) at zero API
  cost.
- **evidence:** `script_preflight.py` — 51 calls across 12 sessions (`super_tools.md`
  §1); explicit archaeology note: *"no chunk-level WPM out of the box — users
  repeatedly had to ask & instrument (86dc34db 13 calls, 685a91 7+ edit loops). Needs
  friendlier summary output + built-in per-chunk WPM."* Per-chunk WPM now built in.
  Auto-invoked by `seedance.py` (= `perform_avatar`) as a hard gate (CLAUDE.md rule
  18). Exit code 1 → seedance refuses to spend credits.

---

## NOT this tool

- `check_layout` — validates face / caption collision and overlay anchor validity
  (`findWord` / `findRange` correctness, caption-safe luminance on B-roll frames)
  **after** `script.json` passes and **before** `compose_render`. Distinct stage.
- `verify_output` — post-render mechanical check (frames extracted, overlays present,
  no black frames, audio present). Runs **after** `compose_render`, not before.
- `analyze_reference` — reads the reference video and produces the
  sentence-grounded analysis that `check_script` Phase 2 *consumes*. Must run before
  `check_script` can audit reference-fidelity gaps.
- `perform_avatar` (`seedance.py`) — the generation tool that auto-invokes
  `check_script` as its own hard gate. Do not bypass with `--skip-preflight` unless
  the reason is documented in `adaptation_notes`.
