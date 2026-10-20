# Frozen render runtime

Committed, version-pinned assets so HyperFrames compositions render **offline**
(no CDN, no render-time network). `tools/hyperframes_render.py` copies this
directory into each composition dir before render.

| File | Version | License | Source |
|------|---------|---------|--------|
| `gsap.min.js` | GSAP 3.14.2 | GreenSock Standard "No Charge" License (**separate from Apache-2.0 — confirm for production**, see ⚠ below) | `cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js` |
| `fonts/inter-variable.woff2` | Inter (Latin, wght axis) | SIL OFL-1.1 | `@fontsource-variable/inter@5.2.5` |
| `fonts/jetbrains-mono-variable.woff2` | JetBrains Mono (Latin, wght axis) | SIL OFL-1.1 | `@fontsource-variable/jetbrains-mono@5.2.5` |

⚠ These are **not** all one license. Full notices + the OFL-1.1 text + the GSAP
licensing caveat are in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
Keep the copyright header inside `gsap.min.js`.

`fonts/fonts.css` declares the two `@font-face` families (`Inter`,
`JetBrains Mono`) against the local woff2 files.

To refresh a pinned asset, re-download from the exact URL above and update this
table. Do not point compositions at a CDN — that would reintroduce a
render-time network dependency.
