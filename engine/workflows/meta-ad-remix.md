# Meta ad research → original HyperFrames remix

Use this workflow when the user wants to study active Meta video ads, select a
transferable creative mechanism, and build a new ad for their own product. It
is not a license to copy another advertiser's footage, wording, identity, or
distinctive assets.

## 1. Acquire public evidence

Choose the user's explicit budget tier and run one typed search. Standard is a
good default after the recorded bakeoff; never increase it without approval.

```bash
uv run python tools/pull_video.py --job <job> --mode search \
  --source meta_ads --query "founder content" --country US \
  --limit 500 --research-tier standard --min-active-days 150 \
  --sort longest_running
```

Read the manifest path printed by the search. Recovery-aware searches save each
run under `jobs/<job>/research/meta_ads/<run>/manifest.json`; older engines use
`jobs/<job>/research/meta_ads/manifest.json`. Treat `active_days` as public
longevity evidence, not proof of conversions or ROAS. Do not fill in
`creative_fit` during acquisition.

## 2. Preview and select

Show the user playable candidates with advertiser, start date, active days,
copy, and Meta Library link. The user selects references before any adaptation.
Download only selected direct video URLs with `pull_video --mode pull`; signed
Meta CDN URLs expire, so preserve the chosen reference under the job.

## 3. Understand the reference

Run `analyze_reference` as eyes, not taste. Record the hook, beat order, shot
types, pacing, typography behavior, proof mechanism, and call to action. Keep
two columns in the adaptation brief:

- transferable mechanism;
- protected or brand-specific expression that must not be copied.

Use local gist/segment transcription when available for bulk triage. Use
`synth_voice --mode transcribe` only when the selected reference needs
word-accurate timing or diarization.

## 4. Load brand context with consent

Ask permission to inspect user-selected brand/project roots. Preview the files,
exclude secrets, and show the extracted brand context before using it. The
script must express the user's own pain, dream outcome, product mechanism, and
proof—not a noun-swapped version of the source ad.

## 5. Author the script first

Write and approve the spoken script before composing visuals. For each beat,
pair the line with its proof obligation and the reference mechanism being
adapted. If the product cannot prove a claim on screen, weaken or remove the
claim.

## 6. Compose new work in HyperFrames

Author the new composition at `jobs/<job>/hyperframes/index.html`, keep every
asset under that job's `hyperframes/` directory, and use relative paths. Load
`runtime/gsap.min.js` and `runtime/fonts/fonts.css`; the renderer provisions
them. The root element carries `data-composition-id`, `data-start="0"` (lint
fails without it), `data-width`, `data-height`, `data-duration` and `data-fps`.
Every timed element has `class="clip"`, `data-start`, `data-duration` and
`data-track-index`. Register one paused GSAP timeline as
`window.__timelines["<composition-id>"]`. Render the authored file:

```bash
uv run python tools/hyperframes_render.py --job <job>
```

It writes `jobs/<job>/final_hyperframes.mp4`. Do not run
`tools/hyperframes_compose.py`: it builds its own composition from a
`final_raw.mp4` this workflow never makes, and replaces the authored
`hyperframes/` directory. Do not migrate an existing Remotion job; legacy
workflows stay supported.

## 7. Build for the right things

The finished render is a complete draft ([Finishing a render](README.md#finishing-a-render)).
Build it so the viewer understands the product, sees themselves using it, believes
the proof, and can repeat the promise. Longevity evidence never becomes a
performance claim.
