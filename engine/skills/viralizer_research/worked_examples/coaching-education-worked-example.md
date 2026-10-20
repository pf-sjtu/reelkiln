# Coaching-education worked example

> **Historical note (2026-05-11):** the "must-author `--queries`" workflow described below has been superseded. `search_outliers.py` now defaults to random-sample mode (no queries needed) — see CLAUDE.md rule 16. The auto-query template collapse documented here is what motivated the move to random sampling; `--queries` is now opt-in drill mode, not the required path.

Live working doc. Updated as we move through the pipeline. Format per phase:
- **What I did** — factual, what tools I ran and what came out
- **What I'm planning next** — my proposed next move
- **Joseph's notes** — improvements, corrections, things I should have done

---

## Phase 0 — Pick company

**What I did:**
- Random pick from `companies/apollo-accounts-export-coaching-education.csv` (3,331 rows) using a Python one-liner with `random.choice`.
- Wrote the result to `/tmp/_pick_coaching.json` and ran `pick_company.py --from`.
- Job created: `corporatespeechsolutions.com-20260502-ek5w3o`.

**Company picked: Corporate Speech Solutions, LLC**
- Website: corporatespeechsolutions.com
- Industry: professional training & coaching
- Employees: 7
- Founded: 2006
- Location: New York, NY
- Description: communication-skills coaching for business professionals — public speaking, accent reduction for non-native English speakers, executive presence, presentation skills, interview prep
- Keywords (notable): accent modification, accent reduction techniques, non-native English speakers, executive presence, vocal presence, public speaking mastery, virtual communication training

**Initial read on the brand:**
- Two clear sub-products: (a) accent modification / accent reduction for non-native English speakers, (b) executive communication / public speaking for native English business folks. These probably need different IVPs and different videos — the audiences barely overlap.
- The lore-positioning sentence isn't obvious from this CSV row alone. They could be "the speech-language pathology people who treat communication as a clinical skill" OR they could be "the executive coach for people whose careers are stuck on a soft skill." We'll know more after `fetch_company.py`.

**What I'm planning next:**
- Run `search_outliers.py` and `fetch_company.py` in parallel (both fast, no big spend).
- Read the website context once it's pulled to disambiguate the brand positioning.
- Then run `gemini_video.py --mode analysis` on the top 1-2 candidates from `candidates.json`.
- Then `--mode replication_brief` on the chosen one to get `style_directives.json`.
- **STOP** before writing vision.md. Share candidates + analysis + my read on which sub-product to make this video for.

**Joseph's notes:**

_(reserved)_

---

## Phase 1 — Outlier search & infrastructure improvements

**What I did:**
- Ran `fetch_company.py` (got `website_context.txt`, ~7k chars).
- Ran `search_outliers.py` with **default auto-generated queries** — got 15 candidates, all generic business/coaching content (top: adamcbenjamin agency case study, rj_hussle real-estate vlog, foundr motivational, katarinaterentieva ad breakdown, drchelsey_parenting research-claim).
- Web-searched the brand: identified founder Jayne Latz, MA, CCC-SLP, CVP. WSJ/Today Show featured. Speech-language pathologists, NOT coaches.
- Drafted lore positioning: *"Speech-language pathology applied to business communication — clinical-grade treatment, not coaching."*
- Drafted IVP target: 32-45 senior IC / middle manager who's been told to "work on executive presence" and doesn't know what to fix.
- Picked sub-product: Public Speaking / Executive Communication (broader TAM than accent reduction).

**Joseph's pushback (audit):**
- The `deep_analysis.md` prompt only says what we DON'T want and is missing positive direction on production observations (shot, camera placement, cuts, B-roll, on-screen text, audio dynamics). This is why outputs default to single-shot avatar-only. **"Probably one of the most important requests in the whole pipeline."**
- `search_outliers.py` should let Claude author IVP-targeted queries instead of relying on generic auto-queries. The auto-queries return generic content because they ask for generic content.

**Infrastructure changes I made (skill-level fixes):**

1. **Rewrote `agent/skills/gemini_prompts/deep_analysis.md`:**
   - Added explicit positive direction on 11 production dimensions (shot composition, camera placement, camera motion, on-screen text per beat, B-roll per beat, speaker behavior, cut count + ASL, music + audio bed dynamics, lighting, background, pacing breakdown).
   - Expanded `response_shape` with new fields: per-beat `shot_composition`/`camera_placement`/`camera_motion`/`on_screen_text`/`b_roll`/`speaker_behavior`; format-level `cut_count`/`average_shot_length_sec`/`pacing_breakdown_pct`; production-level `camera_placement_overall`/`camera_motion_overall`/`b_roll_types`/`audio_bed_dynamics`/`subject_eye_contact`/`subject_gestures`/`background_load_bearing`.
   - Added `replication_guide.production_recipe` — a 1-2 paragraph director's note that names cuts, B-roll, camera approach, lighting, audio, on-screen text — the thing the script-writing agent reads to decide whether to use B-roll, kinetic typography, multi-framing avatars, or straight talking-head.

2. **Updated `agent/tools/search_outliers.py`:**
   - Added `--queries "q1; q2; q3"` (semicolon-separated)
   - Added `--queries-file <path>` (one query per line, `#` for comments)
   - Default behavior unchanged (auto-build queries) but prints a hint suggesting `--queries`.

3. **Updated `agent/CLAUDE.md`:**
   - Added rule 16: *"Author IVP-targeted search queries before running search_outliers.py. Don't rely on auto-generated queries."* — with specific examples of generic-vs-targeted, the workflow steps, and the general-vs-specific test.
   - Updated tools-index entry for `search_outliers.py` to mention the new flags.
   - Updated pipeline diagram with the Claude-authors-queries step before search.

**Re-ran search with Claude-authored queries:**

Saved to `<job_dir>/search_queries.txt`:
```
why some executives sound like leaders and others sound passed-over even with the same content
speech language pathologist breaks down what makes someone sound credible on camera
interview answers that hiring managers actually remember versus forget
three vocal patterns that make smart people sound less smart in meetings
executive presence is a learnable skill not charisma what nobody tells you
```

**Results:** 12 candidates. Top 5 by `combined_score = outlier × similarity`:
1. adamcbenjamin (93x outlier, 0.262 sim, 225k views) — agency case study
2. rj_hussle (33x, 0.347, 29k) — luxury property show vlog
3. foundr (19.9x, 0.275, 85k) — progress > perfection
4. **katarinaterentieva (12.5x, 0.277, 805k) — ad-breakdown craft explainer**
5. saamirir (25x, 0.087, 175k) — Urdu lifestyle (low sim, ignore)

**Honest finding:** Claude-authored queries did NOT meaningfully change the top candidates. Same usual suspects came up. Reason: the DB has very few speech-pathology / executive-communication / interview-answer videos to begin with — this niche is sparse in our corpus. **The IVP-targeted queries help marginally; for sparse-DB niches we're stuck with cross-niche format borrowing (which is fine — drchelsey_parenting was a parenting video that we used as a reference for inevitableyou).**

**One unfortunate side-effect:** the new queries dropped **drchelsey_parenting** out of the top results (it was in the original auto-search at #11 with 4.1x outlier and a strong clinical-authority match). That's a loss — drchelsey's hook anatomy *"Your nine-year-old daughter's confidence window closes in three years. Research on Tween Girls is brutal..."* is the closest positioning match for a clinical SLP brand.

**What I'm planning next:**
- Pick `katarinaterentieva` as primary deep_analysis target (best format + 805k views).
- Optionally also analyze `drchelsey_parenting` (from previous search results) as a secondary positioning reference.
- Run `gemini_video.py --mode analysis` with the *new* prompt to verify the production-detail extraction works.
- Stop and share the verbatim Gemini response.

**Open questions for you:**
- Worth running a second `search_outliers` pass with broader format-targeted queries to recapture drchelsey-style candidates? Or accept that the DB is sparse here and move on with what we have?
- Worth running deep_analysis on BOTH katarinaterentieva (format) and drchelsey_parenting (positioning), or just one?

**Joseph's notes:**

> Add timestamps to deep_analysis (chunked at 2-3s, every chunk gets an entry, single Gemini request for whole video for now).
>
> Run both auto + Claude queries and merge/dedupe — drchelsey-style cross-niche references shouldn't get lost. Mention this in the doc.
>
> Add example-call column to the tools index.

---

## Phase 1.b — Second-round infra fixes from Joseph's audit

**What I did:**

1. **`deep_analysis.md` — chunking mandate added.** New section *"Chunk the video at 2-3 second intervals — every chunk gets an entry"*:
   - 30s video = 10-15 entries; 60s video = 20-30 entries.
   - Even continuous talking-head shots get a new entry every ~3s describing what changed (new gesture, new emphasized word, caption appearing, camera drift, expression shift, eye-contact change). If nothing changed, must say so explicitly.
   - Shot boundaries trump the 2-3s grid — hard cut at 4.7s ends the entry there, no averaging.
   - Entries must be contiguous (each `timestamp_end` = next `timestamp_start`).
   - Decision: single Gemini request for the whole video for now (no client-side chopping). Revisit only if response quality degrades on long videos.

2. **`search_outliers.py` — auto+Claude merge by default.** `--queries` and `--queries-file` now MERGE with auto-built queries instead of replacing them. New `--queries-only` flag suppresses auto for the laser-focused case. Candidate-level dedup (existing) keeps merged results clean.

3. **CLAUDE.md tools index — Example call column added.** Every tool now has at least one canonical example call. Made the table 3 columns: `Tool | Purpose | Example call`. Several tools have multiple example calls (different modes, parallel vs single-chunk, default vs strict, etc.).

**Re-ran search with merged auto + Claude queries (10 total queries, deduped at candidate level):**
- 16 candidates (vs 12 with Claude-only, vs 15 with auto-only).
- drchelsey_parenting recaptured at #12 (sim=0.242, outlier=4.1x, 171k views).
- Other adds via merge: foundr-Naked-Sundays case study, ab.hightower boundary skit, doctormyro pregnancy explainer, lizbrownrealtordaily real-estate truths, startupbell Tesla short.
- Top 5 by combined_score unchanged: adamcbenjamin → rj_hussle → foundr → katarinaterentieva → saamirir.
- katarinaterentieva still my #1 pick for deep_analysis (805k views, "untrained eye" framing).
- drchelsey_parenting still my secondary pick (closest clinical-authority positioning).

**What I'm planning next:**
- Run `gemini_video.py --mode deep_analysis --url <katarinaterentieva_url>` with the new chunked prompt.
- Read the verbatim response, share in chat.
- If response quality is good (dense per-beat detail, populated production fields, useful production_recipe), optionally also run on drchelsey_parenting.
- Then run `--mode replication_brief` on the chosen reference.
- Then **stop again** before writing vision.md.

**Joseph's notes:**

> "did you try it again?" — fair: I had not run the new prompt against a real video. Run it. See what comes back.

---

## Phase 2 — First gemini deep_analysis run + max_tokens fix

**What I did:**

1. Ran `gemini_video.py --mode deep_analysis --url <katarinaterentieva_url>` with the new chunked prompt.
2. **Output truncated** at 17.5s of a 104s video. JSON cut off mid-sentence (*"Makes small"*). 6 chunks completed before hitting the limit.
3. Tracked it down: `gemini_video.py:337` had `max_tokens=4096` hardcoded.
4. **Fixed:**
   - Added `max_output_tokens` field to the `PromptTemplate` class (reads from frontmatter, defaults 16384).
   - Threaded it through `analyse_video()` as a kwarg.
   - Declared `max_output_tokens: 32768` in `deep_analysis.md` frontmatter.
   - Bumped global default from 4096 → 16384 (covers most modes; deep_analysis uses 32k).
5. Also fixed mode-name mismatch: auto-save logic checked `args.mode == "analysis"` but the actual mode is `deep_analysis`. Updated to `args.mode in ("analysis", "deep_analysis")`.
6. Re-ran the analysis. Completed cleanly, 360-line response, JSON parses, all top-level keys populated. Saved manually to canonical path: `<job_dir>/reference/analysis__katarinaterentieva__7540157822407855373.json`.

**Output stats:**
- `visual_breakdown`: 25 entries
- Span: 0 → 145s (video is 105s — see "issue 2" below)
- `cut_count`: 4
- `average_shot_length_sec`: 21
- `pacing_breakdown_pct`: setup 10% / mechanism 85% / payoff 5%
- All production fields populated per beat (shot_composition, camera_placement, camera_motion, on_screen_text, b_roll, speaker_behavior, energy)

**Quality of per-beat detail (huge upgrade vs old 3-line entries):**

> *"Points to the screen, then makes a kissing/pursing motion with her lips as she says 'art direction' for emphasis."*

> *"Hard cut. The background around the Instagram post screenshot turns to black. A red crosshair graphic is overlaid on top of the image, dividing it into four quadrants."*

This is the level we wanted. The script-writing agent now has actionable production direction.

**Two issues found in the output:**

1. **Chunking density looser than asked.** Prompt says *"even continuous talking-head shots get a new entry every ~3 seconds."* Gemini gave 25 entries in 105s = ~4.2s avg, with several entries spanning 6-8s. It's grouping at speech-coherent segments rather than the 2-3s grid.
   *Possible fix:* tighten the language in the prompt, or accept ~4s avg. Per-beat detail (the more important thing) is dense enough.

2. **Timestamps run past video duration.** Last entry ends at 145s but `duration_seconds: 105`. Gemini hallucinated ~40s of phantom timestamps.
   *Possible fix:* pass the actual duration in the prompt context, OR add an explicit "timestamps must not exceed video duration" guard.

**What I'm planning next:**
- Decide whether to iterate the prompt for tighter chunking + duration-bounded timestamps, OR move on with current output.
- If moving on: optionally also run drchelsey_parenting for positioning (~$0.10).
- Then run `--mode replication_brief` on the chosen reference → `style_directives.json`.
- Then stop before vision.md.

**Open questions for you:**
- Tighten the chunking prompt for a re-run, or accept ~4s avg?
- Add a "timestamps must not exceed actual video duration" guard in the prompt?
- Run drchelsey too for positioning, or just go with katarinaterentieva?

**Joseph's notes:**

> "thats a huge problem" + "lets ground gemini in something real" — sentence-anchored layered analysis. Transcribe with Scribe v2, programmatic sentence chunks, then sequential layered Gemini passes (story_arc → shot → overlays → audio → video_level), each pass receives the video + sentence anchor + prior layer outputs. Each layer can have 1-3+ events per sentence. Story arc grounds everything else, so its prompt needs to be really good. The output must POLLUTE Claude's context — not optional read.

---

## Phase 3 — Built `deep_analyze_video.py` orchestrator + sentence-grounded layered analysis

**What I built:**

1. **5 new layer prompt templates in `agent/skills/gemini_prompts/`:**
   - `analysis_story_arc.md` (most important — function taxonomy of 14 arc types, multi-event support, cross-references viralizer.md vocabulary)
   - `analysis_shot.md` (camera + composition + speaker behaviour, receives story_arc)
   - `analysis_overlays.md` (captions / hook_headers / lower_thirds / kinetic_typography / b_roll / graphics / transitions, receives story_arc + shot)
   - `analysis_audio.md` (music_state / music_description / voice_dynamics / sfx, receives all three prior layers)
   - `analysis_video_level.md` (whole-video summary: virality reasons, hook archetype, format, lighting, background, replication recipe — receives all four prior layers)

2. **`agent/tools/deep_analyze_video.py`** orchestrator:
   - Resolves / saves reference video (idempotent via `save_reference_video`)
   - ffprobe duration
   - Extracts audio (mp3, 128k) → ElevenLabs Scribe v2 (word-level)
   - Programmatic sentence grouping: punctuation + 0.4s pause threshold + 25-word cap (configurable)
   - Sequential layered Gemini passes — each call gets video + sentence anchor + ALL prior layers' outputs inlined
   - Merges layer outputs into canonical sentence-row JSON
   - Saves to `<job_dir>/reference/analysis__<creator>__<vid>.json`
   - **Prints full merged JSON to stdout** for context-pollution (CLAUDE.md rule 17)
   - Inlined the two ElevenLabs helpers (`extract_audio` + `transcribe_elevenlabs`) instead of importing from `elevenlabs.py` because that filename shadows the installed `elevenlabs` package when sys.path is mutated. Used a `sys.path` + `sys.modules` workaround to find the installed package cleanly.

3. **CLAUDE.md rule 17** added: *"Read the full `analysis__*.json` BEFORE writing vision.md or script.json. Mandatory, not a shortcut."* Plus updates to tools index (new entry for `deep_analyze_video.py`, marks `gemini_video.py --mode deep_analysis` as legacy/superseded), pipeline diagram (replaces single-pass step), with a `[Claude: MUST Read the saved analysis__*.json]` note in the diagram itself.

**End-to-end run on katarinaterentieva (105s video):**

- 314 words transcribed in 11s
- 21 sentence anchors built
- 5 sequential Gemini passes: 52.9s + 54.4s + 71.7s + 54.7s + 34.1s = ~268s total (~4.5 min)
- Merged JSON saved + printed to stdout

**Verification of the output:**

✅ **Zero timestamp hallucinations.** Every event's `within_sentence_range` is inside its sentence's [start, end]. No phantom 145s seconds anymore.

✅ **Multi-event-per-sentence working as designed.**
- story_arc: 1.2 events/sentence avg (rarely needs sub-sentence splits)
- shot: 1.0 events/sentence avg (camera changes mostly at sentence boundaries)
- overlays: **2.5 events/sentence avg** (captions, B-roll, graphics overlap)
- audio: 1.5 events/sentence avg (music ducks/swooshes mid-sentence)

✅ **Cross-layer reasoning showing up.** Audio layer says *"On 'untrained eye,' tone becomes slightly conspiratorial"* — which references the story_arc layer's loop_widener annotation. Sequential prior-layer-passing is doing real work.

✅ **Sentence grounding works.** Every annotation references a real sentence ID with Scribe-derived timestamps.

✅ **Production recipe is concrete and actionable** (the line the script-writer reads to decide format):
> *"This is a talking-head explainer layered over a static B-roll image. The speaker is in a cutout, changing size and position across 4 major cuts that signal new sections of the video. Production requires roughly 5 long shots, with dynamism driven by animated overlays (grids, arrows, lines) that are drawn on to illustrate the concepts being explained. Sound design should include a constant, low-level ambient music bed and subtle whooshes/hits to accent visual cuts and transitions."*

This says: cutout-over-B-roll, 4 major cuts, 5 long shots, animated overlays do the dynamic work, music bed + transition sfx. That's a useable recipe.

**One discrepancy worth flagging:** the new audio layer says *"low_bed ambient synth pad ~90 BPM"*. The prior single-pass analysis said *"no music; speaker voice only."* They contradict. Need to verify by actually listening — I trust the new layered analysis more (more attentive, single-domain focus) but worth confirming.

**Cost:** ~$1.50 estimated (5 Gemini calls, video re-ingested 5x + 1 ElevenLabs call). Acceptable for the most-load-bearing pipeline step.

**What I'm planning next:**
1. Pause for Joseph's audit on the architecture, output quality, and music discrepancy.
2. If approved, optionally run drchelsey_parenting to validate the orchestrator on a different video type (single shot, no overlays, plain talking-head) — would test the "no overlays" path and the "background_load_bearing" judgment.
3. Then: read the analysis JSON in full (per rule 17), write vision.md.
4. Then: character_sheet.json, script.json (with viralizer.md punch-up).

**Joseph's notes:**

> Architecture & prompts excellent, output excellent (super good, very happy after reading through), some hallucination is manageable, run drchelsey too, and update GEMINI_MODEL to `~google/gemini-pro-latest` (auto-tracks the latest).

---

## Phase 4 — Model upgrade + drchelsey validation run

**What I did:**

1. **Updated `GEMINI_MODEL`** in `agent/tools/gemini_video.py`:
   - First try: `google/gemini-pro-latest` → BadRequestError (`not a valid model ID`)
   - Diagnosed via OpenRouter `/api/v1/models` endpoint — the actual model ID has a tilde prefix: `~google/gemini-pro-latest` (with sibling `~google/gemini-flash-latest`). Joseph had typed it correctly with the tilde the first time; I incorrectly stripped it.
   - Final value: `GEMINI_MODEL = "~google/gemini-pro-latest"`. Auto-tracks the latest stable Gemini Pro on OpenRouter.

2. **Ran drchelsey_parenting analysis** as a second validation on a structurally-different video.
   - Initial run failed with a transient `JSONDecodeError` on the API response. Retried — succeeded.
   - URL fetch was blocked by Instagram's anti-bot wall on yt-dlp; copied the cached reference from the prior `inevitableyou` job and passed the local file path. Worked fine.
   - Renamed the saved analysis from the auto-generated `analysis__src__9ccbf8aea0.json` to the readable `analysis__drchelsey_parenting__DWmnyv8Em9e.json`. (Polish item: the `reference_filename_from_url` helper in gemini_video.py should learn to recognize creator names from local file paths — currently hashes them.)

**Comparison of the two analyses:**

| | katarinaterentieva (Rhode ad breakdown) | drchelsey_parenting (tween confidence) |
|---|---|---|
| Duration | 104.7s | 57.2s |
| Sentences | 21 | 15 |
| Format | `mixed` | `talking_head` |
| Cuts | 4 | 3 |
| story_arc events | 26 | 15 |
| shot events | 21 | 15 |
| overlays events | **53** | **15** |
| audio events | 32 | 24 |
| Hook archetype | `bold_claim` | `bold_claim` |
| Timestamp hallucinations | 0 | 0 |

The architecture **correctly differentiated** the two video types. Different production recipes:

- **katarinaterentieva**: *"talking-head explainer layered over a static B-roll image. The speaker is in a cutout, changing size and position across 4 major cuts. Roughly 5 long shots, with dynamism driven by animated overlays (grids, arrows, lines)... ambient music bed and subtle whooshes/hits to accent visual cuts and transitions."*

- **drchelsey_parenting**: *"To recreate this format you'd want roughly 3 cuts, 0 B-roll inserts, and a completely locked medium camera approach. Lighting should be standard, relatable indoor natural light. The audio must be **bone-dry (no music)** to make the tone feel serious and immediate, ensuring you cleanly capture the practice..."*

**This is what the architecture was supposed to do.** Different references → different production recipes → vision.md will derive different beat sheets → script.json will derive different formats. Plain talking-head still works when that's the *right* call (clinical-authority parenting research delivered with bone-dry seriousness); cutout-over-B-roll-with-graphics works when *that's* the right call (craft-explainer ad breakdown). The script-writer doesn't default; it follows the recipe.

**No timestamp hallucinations on either run.** Sentence-grounding is doing its job.

**Drchelsey sentence-level annotations are tight:** every sentence has 1-2 events per layer; nothing is bloated; every cut and gesture is captured. Example from s14 (the closing CTA):

> *"Comment weekend one and I'll drop you the link."* → story_arc: cta · shot: medium close-up locked, on-camera index-finger downward gesture · overlays: white pill / dark purple bold uppercase captions hard-cutting word-by-word · audio: voice "definitive, confident final call to action"

That's the level of detail the script-writer needs to make a confident format call.

**What I'm planning next:**
- Pause for Joseph's audit (model + drchelsey output) — but I think we're ready to move forward.
- Pick a primary reference for the corporatespeechsolutions video (my lean: drchelsey for the clinical-authority match — it positions Jayne's SLP brand as a clinician making a research-backed urgent claim, which fits her actual lore better than the craft-explainer angle).
- **`Read` the chosen analysis in full** (per CLAUDE.md rule 17) — this happens explicitly in the next conversation turn.
- Run `gemini_video.py --mode replication_brief` to get `style_directives.json`.
- Write `vision.md` with all 5 strategy fields filled out (IVP / core_drive / position / journey / lore_positioning) — derived from the analysis, not from generic intuition.
- Stop and share before character_sheet / script.

**Open questions for you:**
- Which reference should drive the corporatespeechsolutions video — drchelsey (clinical-authority match, talking-head), katarinaterentieva (craft-explainer with overlays, more visually dynamic but further from Jayne's clinical positioning), or BOTH (use drchelsey for the *positioning* and katarinaterentieva for the *production recipe* — heretical but potentially powerful)?
- Replication_brief — should I run it on whichever reference we pick, or on both?

**Joseph's notes:**

> "go for it" — proceed with the heretical hybrid (option 3): drchelsey for arc/positioning, katarinaterentieva for overlay treatment.

---

## Phase 5 — Read analyses (per rule 17), wrote vision.md

**What I did:**

1. **Read the drchelsey analysis IN FULL via the Read tool** — all 848 lines, every sentence row, every layer event. Per CLAUDE.md rule 17, this is mandatory before vision.md and is not satisfied by partial bash-tail output. The full analysis is now in this conversation's context.

2. **Spot-read the katarinaterentieva analysis** for overlay treatments only (since it's the secondary borrow, not the primary structural reference). Pulled the specific overlay events that demonstrate the framework — red crosshair grid, hand-drawn red lines and arrows with draw-on animation. That's the treatment we're translating into Remotion for our video.

3. **Wrote `<job_dir>/vision.md`** with:
   - **All 5 strategy fields** (CLAUDE.md rule 11):
     - **IVP:** Maya, 38, VP-engineering at a mid-stage tech company, second 360-review with "needs to work on executive presence" feedback, scrolling at 11pm.
     - **Core drive:** Status / professional survival. The wound = delta between her self-assessed competence and her externally-perceived value.
     - **Position:** Mentor / credible-witness only. Avatar is a generated mid-40s clinical SLP recommending CSS in third-person, NOT Jayne herself (likeness rights + reliability of generation).
     - **Journey arc:** From *"executive presence is vague and possibly gendered"* → *"it's a measurable speech-pathology pattern with a clinical fix at Corporate Speech Solutions."*
     - **Lore positioning:** *"Corporate Speech Solutions does for executive communication what speech-language pathology does for clinical disorders — measure it, name the dysfunction, install the new pattern. They are clinicians, not coaches."* (anti-coach framing IS the wedge.)
   - **All production fields** with specific bind-points to the drchelsey beat structure and katarinaterentieva overlay treatment:
     - **Format:** mixed — single-shot locked-medium avatar (drchelsey) + Remotion-rendered hand-drawn red ink overlay graphics (katarinaterentieva style) building a diagram drawn-on synced to specific spoken words.
     - **Pace:** 170 WPM (drchelsey is 168; matches clinical-urgency register).
     - **Mood:** bone-dry, serious, clinical authority. Doctor-explaining vibe, not coach.
     - **Beat sheet:** 15-beat target structure mapped sentence-by-sentence to drchelsey's actual arc, with adaptation columns showing what each beat becomes for our IVP. Brand drops at s11-s12 (~70% through, the lore beat moment).
   - **Fact-check items flagged** for script.json — claims that need WebSearch verification before audio (named SLP framework, research citations, the "12,150 hours / 1,500 executives / 18 years" stats from the website).
   - **What this vision deliberately avoids** — explicit anti-patterns I want the script-writer (still me, in next phase) to never lapse into: stale talking-head, any music, first-person *we*, front-loaded brand name, front-loaded jargon.

**Saved:** `<job_dir>/vision.md` — 145 lines, single doc, structured for direct reuse in script.json.

**What I'm planning next:**

1. Pause for Joseph's audit on vision.md. Particularly:
   - Is the IVP sharp enough? Maya/38/director-of-eng/passed-over-once — too specific? Wrong tech-bro coding for an SLP brand whose customer base might skew different?
   - Is the position call (avatar = generated SLP, not Jayne herself) the right call? Or should we try to generate a Jayne-likeness avatar anyway?
   - Does the heretical hybrid (drchelsey arc + katarinaterentieva overlay treatment) feel right, or does it dilute the drchelsey clinical-seriousness?
   - The brand-drop position at ~70% — are we burying the lede or letting it land at the right curiosity peak?

2. If approved:
   - Run `replication_brief` on drchelsey to get `style_directives.json` (caption styling, hook timing, etc. for Remotion).
   - Author `avatar/character_sheet.json` (the SLP archetype Maya will be).
   - Run `generate_avatar.py` to mint the front BytePlus URL.
   - Author `script.json` with verbatim dialogue derived from the beat sheet, fact-checked, viralizer.md punch-up applied.
   - Stop and share before any Seedance spend.

**Joseph's notes:**

> "you have all this context already, let alone an agent that has never seen any of it..." — the 1422-line prompting guide and 850-line analysis are nominally in context but de-facto decay by seedance-prompt time. Need a forcing function. After two design rounds (deterministic regex → semantic detection broke → canonical-phrase string checks → still misses prompt-guide judgment-rules), settled on: **separate LLM call per chunk with all the context loaded fresh, returns a sharp issue list referencing prompt-guide sections, agent reads the report not the context.**

---

## Phase 6 — `script_preflight.py` built (hard gate before seedance)

**What I built:** [`agent/tools/script_preflight.py`](agent/tools/script_preflight.py) — a two-phase audit gate that runs before `seedance.py` and refuses to spend Replicate credits if material gaps remain.

- **Phase 1 (deterministic, fast):** structural checks — `[Image1]` token, dialogue first-8-words verbatim, chunk window vs reference duration, sentence overlap. ERRORs gate even the LLM call.
- **Phase 2 (smart, parallel):** per-chunk LLM call (`anthropic/claude-sonnet-4.6` via OpenRouter) with fresh context: full `seedance_prompting_guide.md` + chunk's reference events from the analysis + vision.md + character_sheet.json. Returns a JSON array of issues with severity (BLOCKING / SHOULD_FIX / NICE_TO_HAVE), guide-section citation, and copy-pasteable fix language.
- **Output:** `<job_dir>/script_preflight_report.md` + console summary. Per-chunk raw LLM responses to `<job_dir>/run/script_preflight__chunk_<idx>__response.txt` for debugging.
- **seedance.py integration:** auto-invokes `run_preflight()` as its first step. Refuses to run if BLOCKING issues remain. `--skip-preflight` flag exists but is documented as rare.
- **CLAUDE.md rule 18** added with full architecture explanation and the rationale for *"why an LLM here when rule 3 says no interim LLM calls"* — answer: this is read-only AUDIT, not generation; output goes to a file, not back into agent context.

**Earlier design iterations that failed (worth capturing):**

1. **Pure deterministic regex/keyword matching for semantic gaps** — `has_no_music_directive` regex matched `\bsilence\b` against "the colon-pause is held in silence" and produced false positives. Semantic-attention checks are exactly what regex is bad at.
2. **Canonical-phrase string checks (require literal "no music")** — would force canonical vocabulary (good) but only enforces the *named* prompt-guide rules. The 80% of the guide that's creative judgment (style anchors, ONE primary camera direction, lighting specificity, separate camera vs subject motion) can't be string-checked.
3. **LLM-call-per-chunk with full context loaded fresh** — the right answer. LLM has all 1422 lines, applies them to a 300-word prompt, returns a sharp list. Agent reads only the report, no context pollution.

**End-to-end run on the Corporate Speech Solutions script:**

```
Issues: 0 BLOCKING · 27 SHOULD_FIX · 9 NICE_TO_HAVE
```

The 27 SHOULD_FIX catches across 5 chunks include exactly what I'd been missing:

- **Reference fidelity (10+ catches):** s1 head-snap, s2 jump cut, s3-s4 marker sounds, s5 jump cut, s6/s7 pointing-to-curve, s10 marker tap, s11 jump cut at brand drop, s12 finger tap, s13 graph pointing, s14 CTA gesture — every load-bearing speaker action in drchelsey we'd dropped without acknowledging.
- **Prompting-guide compliance (10+ catches):** missing canonical multi-camera phrase (*"Character details stay consistent across cuts"*) in 5/5 chunks, missing style anchor (§16.8) in 5/5 chunks, missing audio direction (§2 step 6) in multiple chunks, missing temporal-flicker negative on the >10s chunk, dialogue not quoted inside individual timeline segments.
- **Pipeline-specific (Phase 2 system prompt teaches this):** LLM correctly does NOT flag `[Image1]` usage. *(Initial run had 4 BLOCKING false positives flagging `[Image1]` as a face-upload risk — patched the system prompt to teach the LLM about the API vs UI distinction and that `seedance.py` auto-resolves the BytePlus URL. Re-run had 0 BLOCKING.)*

Each issue cites the specific guide section (e.g. *"§9 missing_canonical_multicamera_phrase"*, *"§16.8 missing_style_anchor"*, *"§7 missing_negative_temporal_flicker"*) with copy-pasteable fixes.

**Cost:** ~$0.50-1 per preflight run (5 parallel calls × ~28k input tokens of guide + chunk context). Wall-clock ~25-40s with parallelism. Acceptable for a load-bearing pre-spend gate that catches gaps that would otherwise burn $1-2 per regenerated chunk.

**Why this fixes the original problem:**

I had read the analysis (rule 17 enforced) and had read the prompting guide many times. Both notionally in context. By seedance-prompt time, the per-sentence detail and the per-§-section detail had decayed into a synthesized mental model. The LLM call gives the model a fresh load of both, applied freshly to my prompt — exactly the in-context attention that I lose by step 5 of the pipeline. The output goes to a file the agent reads, so my working memory only carries the *findings*, not the source material. Same shape as `pacing.py validate` enforces word-budget at exactly the right step.

**Next step (next session):** address the 27 SHOULD_FIX items, then re-run preflight, then `seedance.py`.

**Joseph's notes:**

_(reserved)_


