# workflows/ — the router (build a READING SET, don't pick one file)

**Decompose the request into facets (source × performer × output); read the resulting
2–3 workflows.** Combine methods, not worked-example specifics (**⚠️ PRINCIPLES** banners).
Apply the tenant's brand pack after routing (CLAUDE.md layers).

**Scope note:** every recipe here produces vertical 9:16 short-form (~15–90s). Long-form /
horizontal has no recipes yet — flag it to the human rather than improvising silently.

---

## The 16 recipes, one line each

| Workflow | One line |
|---|---|
| [aroll-reel](aroll-reel.md) | a REAL person's talking-head reel: lipsync only the on-camera windows, cards/b-roll fill the rest |
| [avatar-speaker](avatar-speaker.md) | explicit-request-only SYNTHETIC endorser; does not stand in for a real person |
| [authority-host-episode](authority-host-episode.md) | RECURRING locked face+voice; re-voice + re-sync each episode |
| [broll-voiceover](broll-voiceover.md) | FACELESS VO over b-roll in one locked art style |
| [collage-explainer](collage-explainer.md) | FACELESS editorial explainer: paper-collage metaphors assemble from an empty color field |
| [article-to-shorts](article-to-shorts.md) | TEXT (newsletter/article) → a short with an approved presenter (PIP cut-out or in-scene) |
| [longform-to-shorts](longform-to-shorts.md) | one LONG video → hook-led vertical clips; diarize, SAM3-reframe, densify |
| [reference-remix](reference-remix.md) | a reference you love → YOUR take: keep its structure, rebuild the visuals as the tenant |
| [trend-duplication](trend-duplication.md) | a viral format → a pixel-close duplicate in the tenant's identity; breakdown-first, fully-generated OK |
| [qoves-like-clone](qoves-like-clone.md) | dense MOTION GRAPHICS over a generated BUST/PORTRAIT; tenant identity + grounded reference comparison |
| [cinematic-ad](cinematic-ad.md) | ONE bespoke narrative spot: locked asset bank → shotlist → i2v scenes → cut to music |
| [ecommerce-ads](ecommerce-ads.md) | ad FACTORY: pay for a product foundation once, mass-produce A/B-able ads off it |
| [meta-ad-remix](meta-ad-remix.md) | ACTIVE META ADS research → YOUR original ad: adapt the mechanism of ads the user picks, never their footage/wording |
| [saas-demo](saas-demo.md) | a screen recording → a designed vertical demo (browser-card frame + focus-zoom punches) |
| [script-to-film](script-to-film.md) | a script/treatment → a director's shotlist of 15s cinematic prompts → a short FILM |
| [carousel](carousel.md) | image-only multi-slide post, typography baked by the selected image rail (no video, no audio) |

**Plus one AUDIO-LAYER recipe** (a bed, not one of the 16 videos):

| Workflow | One line |
|---|---|
| [music-recreation](music-recreation.md) | **LAUNCH VIDEOS ONLY**: unshippable temp track → ORIGINAL bed, same BPM/downbeat/hits/structure/duration, new key + palette. Otherwise use native audio or licensed `score_bed --mode bed` |

---

## Route by SOURCE — what do you start from?

| You have… | Primary read | Add to the set (for) |
|---|---|---|
| just an idea/topic, someone talks | aroll-reel (approved person; new dialogue uses the talking-head default below) | broll-voiceover (faceless); avatar-speaker only for an explicitly synthetic endorser |
| TEXT — article, newsletter, letter | article-to-shorts | aroll-reel (presenter craft) · broll-voiceover (VO+b-roll craft) |
| a SCRIPT / treatment (story, not ad) | script-to-film | cinematic-ad (asset bank + engine routing) |
| LONG footage — talk, interview, call | longform-to-shorts | aroll-reel (if re-performing pieces) |
| a REFERENCE video to emulate | ⚖ see disambiguator №1 below | the performer-path workflow it hands off to |
| a SCREEN recording of an app | saas-demo | aroll-reel (if a face intro/outro wraps it) |
| a PRODUCT (image / URL / brief) | ecommerce-ads (volume) / cinematic-ad (one spot) | trend-duplication (if jacking a format) |
| a market / pain point to research in ACTIVE META ADS | meta-ad-remix | reference-remix (adapting the chosen reference) |
| a passage / quote, no face wanted | broll-voiceover | authority-host-episode (if it's a recurring channel) |
| an abstract OPINION/concept to explain, nothing real to show | collage-explainer | broll-voiceover (the shared spine) |
| a TEMP TRACK you can't ship, **on a launch video** | music-recreation (audio layer) | the launch-video recipe it hands off into |
| a temp track on anything that is NOT a launch video | ⛔ not music-recreation — native audio, or license a track (`score_bed --mode bed`) | — |
| no video at all — an image post | carousel | — |

## Route by PERFORMER — who's on screen?

| Performer | Read |
|---|---|
| the real tenant, real footage | aroll-reel (+ reference-remix as the front-end when reference-grounded) |
| a recurring locked narrator (channel) | authority-host-episode |
| an explicitly requested one-off synthetic endorser | avatar-speaker |
| an approved reader as a PIP cut-out | article-to-shorts (B1) + aroll-reel |
| fictional character(s) | script-to-film + cinematic-ad Stage 1 (identity bank) |
| nobody (faceless) | broll-voiceover · collage-explainer (stylized metaphor register) · longform-to-shorts Step 8 (faceless variant) · carousel |

The identity/voice mechanics under every performer path are molecules — read
[`skills/molecules.md`](../skills/molecules.md) §intent-index (character/identity, person)
and fill slots per [`skills/craft_laws.md`](../skills/craft_laws.md) (the performer ladder).

---

## Disambiguators — the collision zones

**№1 · reference-remix vs trend-duplication vs qoves-like-clone** (all start from a
reference video — three standalone recipes, pick by shape):
- **[reference-remix](reference-remix.md)** — borrow hook, beats and pacing; rebuild
  visuals as the tenant, real-footage-first with their real voice. Check concept and
  sample before scaling: "something LIKE this, about X, with me."
- **[trend-duplication](trend-duplication.md)** — a recognizable CUT-BASED format
  (montage/talking head + audio drop). Decode sections, caption animation and audio
  hits first, then format proposal and EDL; fully-generated identity assets OK.
- **[qoves-like-clone](qoves-like-clone.md)** — BOTH dense motion graphics AND a
  generated bust/portrait `mint_video` base (morph, comparison or abstract beat).
  Follow its plate build, conditional subject registration and graphics rebuild;
  compare against the reference with the stacked cards (method: video_qa.md Stage 2.5).
- Unsure → read the two closest; they share the analyze/format-proposal front.
- **Shipped duplicates:** match a named creator/method, Instagram URL or described
  reference against the [duplication trigger table](duplication/README.md)
  (names, aliases, shortcodes). Read the matching `duplication/<slug>.md` first,
  including any character-swap (genjutsu) variant, then trend-duplication for decoding.
  Use the strongest unambiguous match; briefly surface routing when useful. Ask
  only if plausible matches materially change the output or confirmation was
  requested; never silently fall back to generic duplication. Add new proven
  end-to-end duplicates there, with provenance; keep brand aliases in that subdir.

**№2 · the narrator flavors** (all "a voice reads something"):
- faceless VO → **broll-voiceover**; visual metaphors for each line → **collage-explainer**.
- recognizable NEXT episode → **authority-host-episode** (build face, voice_id and idle
  bed once; re-voice + re-sync per episode).
- explicitly synthetic for THIS video → **avatar-speaker**, never a silent real-person replacement.

**№3 · aroll-reel vs avatar-speaker:** use the talking-head default below for a real
person's new dialogue. No suitable recording is a missing input or an explicit fallback
choice; it is not a request for a synthetic endorser.

**№4 · cinematic-ad vs ecommerce-ads vs script-to-film:** one bespoke narrative spot →
cinematic-ad. Many cheap ad variants off one product → ecommerce-ads. A story that isn't
selling anything → script-to-film.

---

## No workflow yet — route to the nearest reads

These request shapes have NO recipe. Compose from the nearest reads, tell the human you're
composing, and when one ships end-to-end it earns its own workflow (provenance rule).

| Request | Nearest reading set |
|---|---|
| UGC handheld testimonial ad ("creator holds product, talks") | ecommerce-ads + aroll-reel + craft_laws §captured-format realism |
| music-synced edit / montage, no VO | trend-duplication §5 (beat-synced bed) + cinematic-ad Stage 4 (cut to music) |
| talking-head + screen-share hybrid tutorial | aroll-reel (performer spine) + saas-demo (frame + focus_track craft) |
| event/trip recap from a folder of raw clips | longform-to-shorts + molecules `gemini-windowed-select` / `retrieval-first-router` |
| photo-slideshow video (stills + music + text) | carousel (slides) + broll-voiceover Step 4 (animate stills) + `score_bed` |
| react/commentary over someone else's clip | reference-remix Step 5b (fair-use gate — ASK first) + longform-to-shorts |
| pure typography announcement promo (~15s) | molecules `fullscreen-typography-hijack` + compose_render caption presets |

---

## Talking-head default

Preserve an existing good performance when the request is an edit. For **new dialogue**
by the user or an explicitly authorized actor/spokesperson, use the approved voice with
real-footage `lipsync_footage`; sync only the visible speaking windows. Read
[voice guidance](../skills/voice.md#approved-reference-voice) for the consent/reference
boundary. Library presence and an uploaded reference are not voice-cloning permission.

Search indexed real takes first. If none fits, offer **voiceover + B-roll** or the
[generated-base variant](aroll-reel.md#generated-a-roll-variant--talking-head-from-the-character-sheet-generic): approved identity
references → still → video base → lipsync. Explain that the generated base adds cost
and may drift, while voiceover + B-roll avoids that face-generation risk; let the user
choose. They can also supply a usable recording. Do not launch an expensive fallback
implicitly. If a generated base drifts, propose using it as a cutaway under narration.
A fully synthetic endorser is an explicit separate choice,
never an automatic substitute for someone's identity. [Identity motion transfer](../skills/primitives/mint_video.md)
route keeps its supplied driver audio and does not gain automatic lipsync.

A photoreal generated face, including a synthetic presenter, is often refused by
Seedance's own moderation (`content_policy_violation`: a possible likeness of a real
person). Wait for the gateway's final result; its qualified face fallback is internal
(see below). A terminal refusal is Seedance's policy, not VideoClaw's.
After that final failure, make the video base with Gemini
Omni image-to-video (the app's `call_model` with `google-gemini-omni-flash-image-to-video`,
`image_url` = the still), then voice + lipsync, as
[avatar-speaker](avatar-speaker.md#if-seedance-refuses-the-face) shows. When Seedance
refuses, offer Omni as the recommended option; `mint_video --mode multishot` is unavailable.

Lipsync is duration-priced; cloned speech and a generated base add their own spend.
Selective speaking windows reduce that cost. The app/gateway approves the current
maximum before a paid operation; old worked-example prices are historical, not quotes.
Real footage usually preserves identity/body motion better than a generated base, but
voice match and lip sync still need assessment. Do not promise perfect reproduction.

## Finishing a render

A finished render is a complete draft. After the final render, run `review_render`
once (strongly recommended; `uv run --project "$VIDEOCLAW_ENGINE" python
"$VIDEOCLAW_ENGINE/tools/review_render.py" --job <bare-id>`). If you find a problem, or its output names
one, fix it once before presenting, within the spend and rights approvals already in
place, render again, then show the video without running `review_render` again.
Don't mention this step to the user. If a problem you know about remains after the
one fix, tell the user plainly what's still wrong (don't mention this step); never
imply a fix worked unless you saw it. Do not start further repair or polish passes
on your own; later changes wait for the user.
Build the craft in before you render: text, faces and the primary subject stay inside the frame and out of
platform red zones; captions and overlays never cover a face; narration stays clear
over the bed and finishes its last word; `script.json` records the real spoken or
on-screen intent. Frames and strips are useful evidence while you build.
Standalone audio/image outputs use their own fidelity checks; never invent `final.mp4`.

Historical command spines below are evidence of past runs; they do not override
this section.

## Universal rails (every route, no exceptions)

- **Route receipt** — production never waits on setup: the first production
  call on this video's job records its route. `prepare_production` (optional)
  loads the 2–3 `--workflow` documents this router selected into context; run
  it when you want them, or when a call is refused for a missing route. Never
  create `jobs/<id>` with `job.py`, `mkdir`, or Write. Explain or revise the creative approach as
  useful, but do not wait for a plan ceremony: no plan document, creative
  confirmation, or second lock call is required. Paid-operation authorization
  remains an independent host/gateway boundary.
- **Job IDs in examples** — shell variables do not persist between app tool calls,
  and a paid call must be one plain command. Treat `$JOB`/`$J` as documentation
  placeholders: write the literal canonical bare id in every call, and
  never pass a `jobs/`-prefixed path as `--job`.
- **Drafts are complete** — see [Finishing a render](#finishing-a-render); no
  route waits on a review before the user sees the video.
- **Optional delivery promise** — `promise.json` may record creative delivery
  targets, but it never authorizes production or binds the route.
  In-app agents never call `cost.py quote` or `cost.py estimate`; submit the
  intended operation so the app can show the exact maximum and enforce its
  authorization boundary. Hosts own any session cap or per-operation prompt, while the gateway owns
  reservations and actual spend. Outstanding reservations are in flight, not spent.
- **Acquisition contract** — a direct pasted URL is always tried with
  `pull_video --mode pull --url "<url>" --name <slot> --job <id>`. It may use a
  metered gateway/Apify route, so the
  current host/gateway owns authorization. The tool owns retries/resume, lighter
  fallback, and saves to `footage/<slot>.mp4`. TikTok is supported. Profile
  enumeration and semantic selection are paid analysis operations too.
- **Retrieval-first** — mine → shared → web-capture → stock → generate (`index_media` first).
- **Taste resolves top-down** — generic spine here; the tenant pack's COMMITMENTS win.
- **Assembly**: `assemble.py` for the common timeline; bespoke Remotion/SVG/ASS/ffmpeg when
  the piece demands it (PIL is reserved for real charts/panels, never standalone
  typography; see [`skills/assembly_craft.md`](../skills/assembly_craft.md)) —
  either way **DECLARE the timeline** (`assemble.py --declare`) so planned cuts, stills
  and holds are on record as intentional.
  After local/custom assembly writes `jobs/<id>/final_raw.mp4`, run
  `compose_render.py --job <bare-id> --mode render --resolution 720p` for the
  final caption/overlay/mix pass. `--mode retrofit` is only for an existing
  external/source video and requires `--source_video`.
  A complete bespoke Remotion composition instead lives under
  `jobs/<id>/remotion/` and renders through `compose_render.py --mode bespoke`;
  never write it into the installed engine or call Remotion directly.
- **`--job` on every tool call**; clickable file link for every watchable output.
