# Primitives — the canonical tool contracts

One contract file per canonical tool (`use_when / do_not_use_when / inputs / success_check / fallback`).
What each tool *does* is described in [`../../CANONICAL_TOOLS.md`](../../CANONICAL_TOOLS.md); this directory
holds the formal per-tool **contracts**. Canonize by **job-to-be-done**, not by backend.

**Validated.** The internal 30-session coverage pass confirmed this set reproduces
every shipped output — **0 sessions needed a 14th generation or 6th checking tool.** The deltas it
surfaced (`reenact`, `fetch_asset`, the `compose_render` output contract, the `strip-chroma` /
`transcribe` / `beats` modes) are baked into the specs below.

## Generation (13)

| tool | modes / roles | spec |
|---|---|---|
| `mint_image` | role: card · seed_frame · overlay · cover · portrait · artistic_still | [mint_image.md](mint_image.md) |
| `mint_video` | mode: insert · keyframe · reenact · edit · genjutsu (multishot unavailable) | [mint_video.md](mint_video.md) |
| `cast_avatar` | job-driven | [cast_avatar.md](cast_avatar.md) |
| `perform_avatar` | job-driven | [perform_avatar.md](perform_avatar.md) |
| `synth_voice` | mode: tts · design · transcribe | [synth_voice.md](synth_voice.md) |
| `score_bed` | mode: bed · generate (opt-in, default off) | [score_bed.md](score_bed.md) |
| `lipsync_footage` | mode: beats · full · long | [lipsync_footage.md](lipsync_footage.md) |
| `clean_audio` | mode: denoise · trim | [clean_audio.md](clean_audio.md) |
| `densify` | mode: normal · aroll · smart · transcribe | [densify.md](densify.md) |
| `pull_video` | mode: pull · select | [pull_video.md](pull_video.md) |
| `compose_render` | mode: render · retrofit · cover_bake · episode | [compose_render.md](compose_render.md) |
| `build_carousel` | mode: two_pass · reference_matched | [build_carousel.md](build_carousel.md) |
| `fetch_asset` | type: logo · headshot · cover · generic | [fetch_asset.md](fetch_asset.md) |

## Checking (6)

| tool | stage — the question | spec |
|---|---|---|
| `look_at_video` | any time — "what does this video (or ours vs the reference) actually look and sound like?" | [look_at_video.md](look_at_video.md) |
| `analyze_reference` | before — "what am I working from?" | [analyze_reference.md](analyze_reference.md) |
| `check_script` | pre-gen — "is the plan sound?" | [check_script.md](check_script.md) |
| `check_layout` | pre-render — "will it render correctly?" | [check_layout.md](check_layout.md) |
| `verify_output` | post-render, mechanical — "is it broken?" | [verify_output.md](verify_output.md) |
| `review_output` | post-render, editorial — "is it good / on-role / not slop?" | [review_output.md](review_output.md) |

## Production preparation (1)

| tool | gate | spec |
|---|---|---|
| `prepare_production` | to load the routed workflow documents into context and stamp the route receipt (production records one itself when none is current) | [prepare_production.md](prepare_production.md) |

## Two kinds of generation tool
- **Prompt-driven primitives** (`mint_image`, `mint_video`) — called with a free prompt + a `--role`/`--mode`. The flexible capability surface (and the future MCP).
- **Job-driven tools** (`cast_avatar`, `perform_avatar`, and the pipeline transforms) — bound to a `--job`; they read job config, not a free prompt. Still canonical tools, just not free-form.

## Contract format (and the over-engineering guard)
`name · purpose · use_when · do_not_use_when · inputs · success_check · backend · fallback`.
If you cannot write a crisp `do_not_use_when`, it is not a primitive — it's a backend wrapper.

## Role / mode logging
`--role` / `--mode` is **required** and logged as `usage_role` — the field `review_output` reads to
ask "did this beat fulfil its role?", and the one that makes the next archaeology free.

## Decision precedence (when a default applies)
`explicit user instruction > brand/user taste memory > workflow recipe > style pack > platform default > hard quality/safety gate`

## Deferred — not built until a shipped output needs it
`mask_object` / SAM3 rotoscope — flagged twice (`371a0e39`, `bfa3f58a`), abandoned before final render both times.
