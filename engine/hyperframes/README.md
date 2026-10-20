# HyperFrames render layer (additive — Remotion stays the shipping default)

A **local, self-hosted** HTML→MP4 render path built on
[HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen's Apache-2.0
renderer). **Licensing note:** HyperFrames itself is Apache-2.0, but the stack is
not uniformly so — the vendored GSAP runtime is under GreenSock's separate
Standard license and the fonts are OFL-1.1. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); the GSAP terms need legal
confirmation before production (issue #112 is licensing-driven). It runs
**alongside** the Remotion pipeline for issue
[videoclaw-app#112](https://github.com/INFR-Organisation/videoclaw-app/issues/112)
— Remotion is unchanged and remains the default render layer.

**The full authoring guide is [`docs/hyperframes.md`](../docs/hyperframes.md).**
This file is a map of the directory.

```
hyperframes/
  package.json          pinned hyperframes@0.7.90 · Node ≥ 22.12 · lockfile committed
  package-lock.json
  hyperframes.json      shared project config (registry paths, media.autoProxy)
  runtime/              FROZEN, committed local runtime (no render-time network)
    gsap.min.js           GSAP 3.14.2 (animation runtime)
    fonts/                Inter + JetBrains Mono variable woff2 (OFL-1.1) + fonts.css
  examples/
    make_assets.sh        regenerates local test media (gitignored output)
    textcard/index.html   simple port  of remotion/src/TextCard.tsx
    diagramreel/index.html motion-heavy port of remotion/src/DiagramReel.tsx
```

## Setup (one time)

```bash
npm install --prefix hyperframes        # pinned CLI + its headless Chrome
bash hyperframes/examples/make_assets.sh   # local test media for the examples
```

## Render (the engine tool — the supported path)

```bash
uv run python tools/hyperframes_render.py --job <job-id>
# → jobs/<job-id>/final_hyperframes.mp4   (never final.mp4 — that stays Remotion's)
```

See [`docs/hyperframes.md`](../docs/hyperframes.md) for the composition contract,
the two known-good example ports, the Remotion↔HyperFrames comparison, and known
limitations.

The `runtime/` directory is the single frozen source of truth for the GSAP +
font runtime. `tools/hyperframes_render.py` provisions a **byte-verified** copy
of it into each composition directory before rendering (a tampered or corrupted
runtime file is repaired), so compositions reference `runtime/gsap.min.js` /
`runtime/fonts/fonts.css` and render fully offline — no CDN, no HeyGen cloud, no
paid vendor call.

The tool renders to a temporary file, `ffprobe`-validates it, and only then
**atomically** replaces `final_hyperframes.mp4` — a failed render never
publishes a partial artifact and never disturbs a previous valid output. It
**never** writes `final.mp4` (the Remotion artifact), which is rejected
unconditionally with no override.
