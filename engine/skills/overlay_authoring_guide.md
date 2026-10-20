# Overlay Authoring Guide — pipeline-specific Remotion rules

This guide is for authoring `<job_dir>/overlays.tsx` per video. Claude writes
this file directly using full Remotion expressivity — no closed menu, no
template registry. The guide enforces consistency across renders and surfaces
the pipeline-specific patterns we keep needing.

> **`<job_dir>/overlays.tsx` is available whenever the creative plan benefits
> from an authored graphics layer.** A captions-only or deliberately minimal
> render is also a valid production choice. When the design brief commits the
> job to a specific typography palette, signature-stat treatment, per-chunk
> visualizers, brand intro card with real assets, or SFX layer, author the brief at
> `<job_dir>/design_brief.md` (see
> [design_brief_guide.md](design_brief_guide.md)), then implement every
> promised row here. The finished render shows whether the chosen treatment works;
> the renderer does not force an overlay merely to satisfy a pipeline ritual.

> **For any image asset an overlay needs (cards, backgrounds, badges,
> stamps, transparent glyphs), generate via `agent/tools/generate_image.py`
> — NEVER inline replicate calls inside Python or React. That tool ships
> gpt-image-2 + seedream backends, writes to `<job_dir>/images/` with a
> manifest, and integrates cleanly with `staticFile()`.** For audio
> effects, search/fetch stable IDs with `tools/sfx_catalog.py` (see
> [sfx_guide.md](sfx_guide.md)). If no cue fits, omit it or ask the user.
>
> **When `<job_dir>/overlays.tsx` exists, the JOB OWNS the overlay layer.**
> `remotion_render.py` automatically skips the legacy hook/url/lower-third
> auto-overlays so they don't double-render. Pass `--legacy-overlays` only
> if you explicitly want both.

> **For Remotion fundamentals (animation, captions, sequencing, audio,
> typography, frame extraction), DEFER to the installed skill at
> `~/.claude/skills/remotion-best-practices/rules/<topic>.md`.** Re-read the
> relevant rule files at the start of each authoring session — they are the
> source of truth for HOW Remotion works. This guide is the source of truth
> for HOW THIS PIPELINE uses Remotion.

> **Reusable patterns library lives in [§12](#12-patterns-invented-on-the-job-worth-re-using).**
> Read it BEFORE authoring a new overlays.tsx — most edit-pass moves
> (textured background cards, stat reveals, pull-quote cards, brand end-
> cards, tasteful b-roll) already have named recipes there with smart-
> variable defaults, code skeletons, and SFX pairings. The recipes are
> generalizable across brands — adjust the variables, don't reinvent the
> structure.

---

## 0. The contract — what overlays.tsx is

A per-job file at `<job_dir>/overlays.tsx`. The pipeline symlinks it into
`agent/remotion/src/_currentJobOverlays.tsx` before render or preview, and
`Captioned.tsx` imports from there.

The file MUST default-export a single React component with this signature:

```tsx
import type { JobOverlaysProps } from "../../../agent/remotion/src/_jobOverlaysContract";
export const JobOverlays: React.FC<JobOverlaysProps> = (props) => { ... };
export default JobOverlays;
```

`JobOverlaysProps` is defined in `agent/remotion/src/_jobOverlaysContract.ts`
and is exactly:

```ts
type JobOverlaysProps = {
  jobPublicPath: string;     // e.g. "_jobs/teuwen.com-20260504-zgrdxj"
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
};
```

The component fetches whatever per-job data it needs (motion plan, asset
manifests) via `staticFile(`${jobPublicPath}/...`)`. The base `Captioned`
composition stacks `<JobOverlays />` ON TOP of the avatar video, captions, and
the legacy hook/url/lower overlays. Layer order from bottom to top:
1. Avatar video (`<Video>`)
2. Audio bed (optional)
3. Captions
4. Legacy overlays (hook banner, url pill, lower-third)
5. **JobOverlays** ← what you're authoring

So your overlays render on top of everything else. Use `pointer-events: none`
on decorative layers.

---

## 1. Required reading from the Remotion skill

Before you write a single line, read the rule files relevant to what you're
doing. These are at `~/.claude/skills/remotion-best-practices/rules/`:

| Pattern you're building | Read these rule files |
|---|---|
| Any text reveal / typewriter | `text-animations.md`, `timing.md` |
| Card / overlay entrance/exit | `timing.md` (springs, easing), `sequencing.md` |
| Multiple beats scheduled in a timeline | `sequencing.md` (`<Sequence>`, premountFor) |
| Audio replacement (TTS over avatar) | `audio.md` (volume callbacks, muting, trimming) |
| Image overlay | `images.md`, `assets.md` |
| Custom font for a card | `fonts.md` |
| Anything Tailwind | `tailwind.md` |
| Frame-level verification | `extract-frames.md` (Mediabunny) |

Don't paraphrase the skill. If a snippet exists, copy-paste-adapt it.

---

## 2. Canvas + safe zones

**Read the canvas; never assume portrait.** The canvas follows the source video.
With no `width`/`height` in `style_directives.json`, a portrait source renders on
1080 × 1920, a landscape one on 1920 × 1080 and a square one on 1080 × 1080; a
`video_transform` keeps 1080 × 1920 (see
[`primitives/compose_render.md`](primitives/compose_render.md); `compose_render`
prints the canvas it chose). Size and place every element from the `width` and
`height` props of `JobOverlaysProps` (or `useVideoConfig()`), as fractions of the
frame, and branch where a layout only works one way:

```tsx
const { width, height } = props;         // the real canvas, never a constant
const landscape = width > height;
const y = (fraction: number) => Math.round(height * fraction);
```

Pixel values below are for each orientation's canvas; rows given as a fraction of
`height` scale to any canvas.

| Property | Portrait 1080 × 1920 | Landscape 1920 × 1080 |
|---|---|---|
| FPS | 30 | 30 |
| Top safe zone | First 220px (platform UI) | First 54px (5% graphics-safe) |
| Bottom safe zone | Last 460px (captions + platform UI) | Last 54px (5% graphics-safe); captions sit above it |
| Side safe zones | 60px left + right | 96px left + right (5% graphics-safe) |
| Platform red zones | Checked by the layout preflight (`red_zones.py`) | None published for 16:9: the preflight reports them SKIPPED, so the margins above are yours to keep |
| Hook banner band (0.10–0.19 × height) | y = 200–360 | y = 110–205 |
| Captions band (from `height × vertical_anchor_ratio` to ≈0.82 × height) | y ≈ 1380–1575 with the 0.72 presets | y ≈ 780–885 with the 0.72 presets |
| Legacy lower-third (`Overlays.tsx`, fixed 460px above the bottom) | y = 1380–1460 | y = 540–620 (mid-frame: author your own instead) |
| URL pill band (fixed 80px above the bottom) | y = 1730–1840 (overlaps captions — only shown last 5s when captions can move up) | y = 890–1000 |
| Free zone (no safe-zone collisions) | y = 365–1380, full width minus side safe zones | y = 205–780, full width minus side safe zones |

Captions start at `height × vertical_anchor_ratio` from the caption preset in use
(0.72 in most presets; `josephchin` uses 0.55, i.e. y ≈ 1056 portrait / 594
landscape), so read it from `style_directives.json` rather than assuming a band.

**Face-bbox respect.** In a portrait talking head the avatar's face is roughly
center-frame, head-and-shoulders, ~y = 400–1100. In landscape, where the face sits
depends on the shot (often one side of the frame), so locate it rather than assuming
a band. Overlays in the face's band MUST either:
- Be *intentionally* obscuring the face (email_reveal, tweet_quote — the avatar's voice
  is talking *about* this content)
- Or sit clear of the face bbox (cards on the left/right edges, full-width banners
  outside the band)

Never put a decorative card directly over the face. Use `agent/tools/preflight.py` to
detect face-bbox collisions before render.

---

## 3. Type scale + color tokens (defaults)

Use these as your starting palette unless `style_directives.json` overrides:

```ts
// Type scale (fraction of canvas `height`; ~px at 1920 portrait / 1080 landscape)
const TYPE = {
  hook: 0.055,        // ~106px / ~59px
  title: 0.045,       // ~86px / ~49px
  body: 0.035,        // ~67px / ~38px
  caption: 0.055,     // ~106px / ~59px (matches CaptionPage default)
  url_pill: 0.032,    // ~61px / ~35px
  small_label: 0.022, // ~42px / ~24px
};

// Color tokens
const COLOR = {
  text_primary: "#FFFFFF",
  text_inverse: "#0B0B0F",
  text_muted: "rgba(255,255,255,0.7)",
  surface_glass: "rgba(20,20,26,0.7)",     // for liquid-glass cards
  surface_solid: "rgba(11,11,15,0.92)",
  accent: "#FFD400",                        // matches existing UrlPill yellow
  accent_alt: "#39E508",
  danger: "#FF4757",
  outline: "rgba(0,0,0,0.55)",
};
```

Override per job when the brand calls for it (e.g. wine PR → softer
muted-gold accent, parenting → warmer pastel). Document overrides in a
comment at the top of overlays.tsx.

---

## 4. Motion language

Defer to `~/.claude/skills/remotion-best-practices/rules/timing.md` for the
mechanics. Pipeline conventions:

```ts
// Standard durations (in frames at 30fps)
const ENTER_FRAMES = 8;     // ~270ms — quick but not jarring
const EXIT_FRAMES = 5;      // ~170ms — faster out than in
const HOLD_AFTER_ENTER = 4; // small pause before any motion within the beat

// Standard spring configs
const SMOOTH = { damping: 200 };                       // calm reveals (titles)
const SNAPPY = { damping: 22, stiffness: 200 };        // UI elements (cards)
const BOUNCY = { damping: 8 };                         // playful (numbers, callouts)

// Standard easings (combine with interpolate)
import { Easing } from "remotion";
const EASE_OUT = Easing.out(Easing.cubic);             // standard exit-of-anim
const EASE_IN_OUT = Easing.inOut(Easing.cubic);        // smooth two-sided
```

**Rule of one.** At any given frame, only ONE element on screen should be
visibly *moving* — a card entering, a number popping, a word emphasising.
Two simultaneous motions read as nervous; three reads as ad-tech. The
caption track's baked-in 1px ambient drift (Layer 1, see
`style_layering.md`) is subliminal and does NOT count as the moving
element — it's there exactly so the frame never feels dead, freeing the
"one moving thing" budget for the bespoke beat that needs it.

**Corollary — captions are Layer 1, not your motion surface.** The caption
track's *layout, motion, and behaviour* are global defaults you don't
modify per-job. Brand color identity (active-word color, font) is Layer 2
(`style_directives.json`). Bespoke kinetic emphasis is Layer 3 — author
it as an *additive* element in overlays.tsx (a phase-up impact word, a
beat-anchored stat reveal, a pivot card), beat-anchored to a transcript
word, never as a modification of the caption track itself. This keeps
the caption identity consistent across every video the system ships
while still giving each video its own bespoke moment of motion.

---

## 5. Anchoring beats to transcript words

You almost always want a beat to fire when a SPECIFIC word is spoken, not
at a hardcoded timestamp. Pattern:

```tsx
import { useMemo } from "react";

// Find the word's start time from the transcript
const findWordStart = (
  transcript: { word: string; start: number; end: number }[],
  search: string,
  occurrence = 1,
): number | null => {
  let seen = 0;
  for (const t of transcript) {
    if (t.word.toLowerCase().replace(/[^\w]/g, "") === search.toLowerCase()) {
      seen += 1;
      if (seen === occurrence) return t.start;
    }
  }
  return null;
};

const startSec = findWordStart(transcript, "important", 1);
const startFrame = Math.round(startSec * fps);
```

For a beat that spans from word A to word B:

```tsx
const startSec = findWordStart(transcript, "send");
const endSec = findWordEnd(transcript, "important");  // .end of that word
const durationFrames = Math.round((endSec - startSec) * fps);
```

Always log a clear console.warn when a word can't be found — the model can
silently drop a beat otherwise. `Captioned.tsx` will continue rendering,
but the beat won't show.

### 5.0 The preferred path: anchor by chunk index, not by word

For most overlays (cards covering whole chunks, screen-hijacks, end-cards
anchored to "the start of chunk N"), use **`chunk_boundaries.json`** instead
of `findWord`. The file is auto-generated by `remotion_render.py` from
`script.json` + `transcript.json` and contains exact start/end timestamps
per chunk index — with fuzzy matching that survives the routine TTS failures
where Scribe drops a quiet onset word ("First,", "And finally,").

```tsx
type ChunkBoundary = {
  index: number;
  start_sec: number;
  end_sec: number;
  dialogue_first_word: string | null;
  dialogue_last_word: string | null;
  anchor_method: string;  // exact_match / fuzzy_match / fallback_*
  fallback_reason?: string;
};

type ChunkBoundaries = {
  computed_at_utc: string;
  chunks: ChunkBoundary[];
};

const boundaries = useJobJson<ChunkBoundaries>(`${jobPublicPath}/chunk_boundaries.json`);
if (!boundaries) return null;

// Anchor by chunk index — robust to re-densify, dialogue edits, TTS drops.
const clear = boundaries.chunks[4]; // "First, you Clear your head..."
<Sequence
  from={Math.round(clear.start_sec * fps)}
  durationInFrames={Math.round((clear.end_sec - clear.start_sec) * fps)}
>
  <PillarCard step={1} name="Clear" ... />
</Sequence>
```

**Why this is the default:**
- One Source Of Truth — `chunk_boundaries.json` is recomputed on every
  `remotion_render.py` run, so re-densify / dialogue edits flow through
  to overlay timing automatically.
- Survives TTS failures — when "First," is dropped from PASS 2 transcript,
  the matcher's shift-tolerant fuzzy alignment still anchors chunk 4 to
  the actual audio start (the "you" word at the correct time).
- No hardcoded seconds — overlays.tsx written against chunk indices
  doesn't drift across re-renders.

**When to fall back to `findWord` (§5 + §5.1):** word-level effects
INSIDE a chunk (word-pops, per-word color shifts, micro-anchored SFX).
For chunk-level cards, always prefer `chunk_boundaries.json`.

**Debug a single job's boundaries:**

```bash
uv run python agent/tools/chunk_boundaries.py --job <id> --dry-run
```

Prints the computed boundaries to stdout without writing. Useful when
authoring overlays.tsx and you want to see which chunk index corresponds
to which time range.

### 5.1 The findWord foot-gun (real bug we shipped)

`findWord("come", 1)` matched *"has come full circle"* instead of the
intended *"many more to come"* — caught only after a full render. The
silent failure mode: if your needle word appears multiple times, occurrence
1 is the FIRST match, which may not be the one you want.

**Mitigations:**

1. **Use `findWord(words, "come", -1)` for the LAST match.** Negative
   occurrences count from the end. The shipped `findWord` helper in
   overlays.tsx supports this — see chung-press job's overlays.tsx for the
   reference impl.

2. **Always specify the occurrence explicitly when you know the word
   appears more than once.** `findWord("get", 2)` for the second "get",
   not the silent default of 1.

3. **Run the pre-render anchor sanity check:**

   ```bash
   uv run python agent/tools/check_overlay_anchors.py --job <id>
   ```

   This statically scans your overlays.tsx for every `findWord` /
   `findRange` call, resolves it against the transcript, and reports:
   - ❌ words that don't appear at all (overlay will silently no-op)
   - ⚠️  words with multiple matches when occurrence=1 (might be wrong one)
   - ✓ resolved anchors with timestamps + 3-word context

   Run this after EVERY edit to overlays.tsx. Catches the next bug for free.

---

## 6. Loading per-job data

The job dir is symlinked into `public/_jobs/<id>/` so any file in the job
dir is reachable via `staticFile()`. Common patterns:

```tsx
import { staticFile, delayRender, continueRender, cancelRender } from "remotion";

const useJobJson = <T,>(path: string): T | null => {
  const [data, setData] = useState<T | null>(null);
  const [handle] = useState(() => delayRender(`Loading ${path}`));
  useEffect(() => {
    fetch(staticFile(path))
      .then(r => r.json())
      .then((j: T) => { setData(j); continueRender(handle); })
      .catch((e) => cancelRender(e));
  }, []);
  return data;
};

// In your component:
const transcript = useJobJson<TranscriptShape>(`${jobPublicPath}/transcript.json`);
const motionPlan = useJobJson<MotionPlan>(`${jobPublicPath}/motion_plan.json`);
```

Always `delayRender` while fetching — Remotion will wait before rendering
the frame. Without it, you'll get blank frames at the start.

---

## 7. The `audio_replace` pattern

When you want a different voice (TTS) to read content while the avatar's
mouth is hidden by an overlay:

**Pre-process step (Python):** `agent/tools/patch_audio.py` produces
`<job_dir>/final_raw_patched.mp4` with the avatar's audio muted in the
[start_word..end_word] window and TTS spliced in. Then `densify.py`-style
re-transcribe (PASS 3) updates `transcript.json` to match the patched audio.

**In overlays.tsx:** there's no audio work to do — the patched MP4 is the
base layer. You're only responsible for the VISUAL overlay that hides the
avatar during the TTS section + briefly reveals the avatar at the
loop_widener moment if any.

```tsx
const beatStart = findWordStart(transcript, "send");
const beatEnd = findWordEnd(transcript, "important");
const briefRevealStart = findWordStart(transcript, "next");
const briefRevealEnd = briefRevealStart + 0.8; // reveal for 800ms

const startFrame = Math.round(beatStart * fps);
const durationFrames = Math.round((beatEnd - beatStart) * fps);

return (
  <Sequence from={startFrame} durationInFrames={durationFrames}>
    <EmailReveal
      transcript={transcript}
      briefRevealWindow={[briefRevealStart, briefRevealEnd]}
      ... />
  </Sequence>
);
```

The `briefRevealWindow` is converted inside the component to a frame range,
and the overlay's opacity goes to 0 during that window so the avatar shows
through.

---

## 8. The typewriter pattern (TTS-anchored)

For "type characters in as words are spoken" reveals (email body, tweet,
text message):

```tsx
const Typewriter: React.FC<{
  text: string;
  ttsWords: { word: string; start: number; end: number }[]; // PASS 3 transcript subset
  startSec: number; // beat start in absolute video time
}> = ({ text, ttsWords, startSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tNow = startSec + frame / fps; // absolute time

  // How many CHARACTERS of `text` should be visible?
  // Walk the words, find the current word, interpolate within it.
  let charsVisible = 0;
  let cursorInText = 0;
  for (const w of ttsWords) {
    const wordStart = cursorInText + text.slice(cursorInText).indexOf(w.word);
    if (wordStart < 0) break;
    const wordEnd = wordStart + w.word.length;

    if (tNow < w.start) {
      charsVisible = wordStart;
      break;
    }
    if (tNow >= w.end) {
      charsVisible = wordEnd;
      cursorInText = wordEnd;
      continue;
    }
    // Currently being spoken — interpolate within the word
    const progress = (tNow - w.start) / Math.max(0.001, w.end - w.start);
    charsVisible = Math.floor(wordStart + (wordEnd - wordStart) * progress);
    cursorInText = wordEnd;
    break;
  }

  return (
    <div>
      {text.slice(0, charsVisible)}
      <BlinkingCursor />
    </div>
  );
};
```

Use string slicing — never per-character opacity (per the skill's
text-animations.md rule).

---

## 8.5. Lessons learned (real bugs we've shipped — don't repeat)

These bugs cost re-renders on the Teuwen job. Each one is easy to repeat without warning.

### 8.5.1 The `normalize()` apostrophe gotcha

The standard `normalize` helper strips non-word chars:
```ts
const normalize = (s: string) => s.toLowerCase().replace(/[^\w]/g, "");
```

**`"We've"` normalizes to `"weve"`, NOT `"we"`** — the apostrophe is stripped but the `'ve` letters remain. So `findWord(words, "We", 2)` returns null (the second occurrence of `"we"` doesn't exist; `"weve"` is what's in the transcript).

**Fix:** anchor on a unique surrounding word that has no apostrophe (e.g. `"already"` for the line `"We've already booked..."`). Always add a defensive check + `console.warn`:

```ts
if (!anchor1 || !anchor2 || ...) {
  console.warn("[overlays] missing anchors:", { anchor1: !!anchor1, ... });
  return null;
}
```

### 8.5.2 The Sequence-local `useCurrentFrame()` time-conversion

`useCurrentFrame()` inside a `<Sequence from={N}>` returns LOCAL frames (starting at 0 when the Sequence enters). To get absolute video time inside a child component:

```tsx
// WRONG — assumes the Sequence started at the first word's start time
const tNow = ttsWords[0].start + frame / fps;

// RIGHT — pass the parent Sequence's absolute start time as a prop
const Typewriter: React.FC<{ ..., sequenceStartSec: number }> = ({ sequenceStartSec, ... }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tNow = sequenceStartSec + frame / fps;  // absolute
  ...
};
```

When you wrap a beat in `<Sequence from={Math.round(beatStartSec * fps)}>`, pass `beatStartSec` to every child that needs absolute time.

### 8.5.3 Opacity double-inversion

If the parent computes `1 - exitProgress` and passes it to a child that internally does `interpolate(progress, [0, 1], [1, 0])`, you've inverted twice and the opacity is always 0.

**Pick a convention:** either the parent sends "raw progress" and the child interprets, or the parent sends "alpha-ready (0=invisible, 1=visible)" and the child uses it directly. Document in the prop name (e.g. `exitAlpha` vs `exitProgress`).

### 8.5.4 Don't re-load fonts that `Captioned.tsx` already loads

`Captioned.tsx` calls `loadInter("normal", { weights: ["700", "800", "900"], subsets: ["latin"] })`. If you also call `loadInter()` from `<job_dir>/overlays.tsx`, webpack tries to resolve `@remotion/google-fonts/Inter` from the JOB DIR (which has no `node_modules`), and the bundle fails.

**Fix:** assume Inter at weights 700/800/900 is already available. Use it directly. If you need a different font, load it in `Captioned.tsx`, not in the per-job file.

### 8.5.5 Empty highlighted rows visible during the wrong beat

If you render a `<Typewriter>` inside a styled wrapper `<div>` (yellow background, left border, etc.), the wrapper is ALWAYS visible — even when the Typewriter shows 0 chars. The empty highlight box telegraphs the upcoming beat.

**Fix:** gate the WRAPPER's visibility on `tNow >= line.ttsWords[0].start`. Use `opacity` so it can fade in:

```tsx
const lineRevealAt = line.ttsWords[0]?.start ?? 0;
const lineOpacity = interpolate(tNow, [lineRevealAt - 0.25, lineRevealAt], [0, 1], { ...clamp });
if (lineOpacity <= 0) return null;
return <div style={{ opacity: lineOpacity, ...wrapperStyle }}>...</div>;
```

### 8.5.6 The `inputProps.json` startup-cache trap (Studio)

`preview.py` writes `<job_dir>/inputProps.json` once when it spawns the Studio. The Studio reads this ONCE at startup. **Edits to `style_directives.json` after that don't propagate** until you restart `preview.py`.

The overlays.tsx file IS hot-reloaded (it's React code that the Studio's webpack watches). Just style settings need a restart.

---

## 9. The DON'T list

Hard violations — the renderer's `preflight.py` catches some, you must
catch the rest:

- ❌ **Text smaller than 3% of canvas height (~58px portrait, ~32px landscape)** —
  viewers can't read.
- ❌ **Hard-coded portrait pixel positions** — a landscape source renders on
  1920 × 1080, so a card placed at a portrait `y` lands below the frame. Position
  from `height` (§2).
- ❌ **Two overlays on the same vertical band at the same time** — they
  collide. Use `<Sequence>` to separate or place in different bands.
- ❌ **Decorative overlays touching the face bbox without intent** — see §2.
- ❌ **Per-character opacity for typewriter** — janky compared to string
  slicing (see §8).
- ❌ **Hardcoded timestamps** — anchor to transcript words (§5). Hardcoded
  ms shifts when audio changes (densify, patch_audio).
- ❌ **Image-gen for content that includes legible text** — the image model
  garbles text. Render text in Remotion (TSX), use image-gen only for
  imagery without text.
- ❌ **Auto-defaulting to a hook banner that overlaps the face when face is
  high in frame** — measure with face-bbox if there's any chance of
  collision.
- ❌ **Fonts loaded at top level without `loadFont()` from
  `@remotion/google-fonts/<Family>`** — they don't render in the headless
  browser. See `~/.claude/skills/remotion-best-practices/rules/fonts.md`.
- ❌ **Audio overlap without explicit volume curves** — both tracks fight,
  the result is mud. Use `volume={f => ...}` on at least one.
- ❌ **Stacking visual emphasis on the same word** — caption-italic AND
  word-pop overlay on the same spoken word is overkill (the user pulled the
  word-pop on the Awaken job for exactly this reason). Pick ONE channel per
  word. Default: caption-italic carries script-asterisk emphasis cleanly
  via the `italic_word_starts_ms` style_directive (see CaptionPage.tsx).
  Reserve word-pop overlays for words the caption track can't carry — e.g.
  if captions are suppressed during a card moment, or if a single beat
  earns the "one moving thing" budget across the whole video.
- ❌ **Per-job overlays that overlap the caption band** — captions run from
  `height × vertical_anchor_ratio` to ≈0.82 × height (y≈1380–1575 portrait,
  y≈780–885 landscape with the 0.72 presets; §2). Custom cards in this band cover
  captions. `preflight.py` now flags `caption_band_collision` with IOU > 5%;
  fix by moving the card into the free zone (§2) or shrinking it. (The
  MCC card on the Awaken job triggered this — flagged after-the-fact by
  the user; now caught by preflight.)

---

## 10. Authoring workflow

0. **Multishot pass — read the canonical reference overlay files.** Before
   anything else, read
   [`agent/skills/user_post_production_voice/_references/README.md`](user_post_production_voice/_references/README.md)
   and then read the full TSX end-to-end of at least one reference whose
   register matches your job (Jeffrey Shaw = restrained brand; Jen Moff =
   high-production stat takeover; Awaken = iteration-minimal; Protocol
   School = choreographed countdown with SFX, paired with its design brief;
   Sanespaces = screen-hijack salvage when avatar visuals are weak). Reuse
   their helpers (`useJobJson`, `findWord`, the textured-paper primitive)
   rather than re-deriving what's already validated, but never copy a
   position or size as fixed pixels: the references were authored on the
   1080 × 1920 portrait canvas, so scale every `top`/`left`/size to this
   job's canvas as a fraction of `height`/`width` (§2) — `top: 1450` becomes
   `Math.round(height * 1450 / 1920)`. This is the multishot equivalent of how
   `user_script_voice/PATTERNS.md` + EDIT_PAIRS are read before drafting a
   script.
1. **Re-read this guide + the relevant skill rule files** for the patterns
   you're using.
2. **Read the job's `script.json`** — chunks, dialogue, post_production_notes.
   The notes tell you what beats the script intends.
3. **Read the job's `transcript.json`** (PASS 2 from densify) — get word
   timestamps for anchoring beats.
4. **Read `style_directives.json`** if present — caption style is already
   handled by `CaptionPage.tsx`, but the brief may mention overlays /
   palette / motion notes worth honoring.
5. **Check `vision.md`** — format / mood / on-brand vs off-brand notes.
6. **Write `<job_dir>/overlays.tsx`** as a single component file. Use
   sub-components within it freely. Inline hex colors only when overriding
   the §3 tokens; otherwise import the tokens from a shared module if you
   like.
7. **Run `agent/tools/preview.py --job <id>`** — opens the Remotion Studio
   in the browser. Iterate on motion / timing / positioning live.
8. **Run `agent/tools/verify_render.py --job <id>`** — pulls 5-8 frames at
   beat anchor moments via Mediabunny, surfaces them inline in chat for
   sanity-check before final render.
9. **Run `agent/tools/remotion_render.py --job <id>`** — final headless
   render to `<job_dir>/final.mp4`.

---

## 11. The overlays.tsx skeleton (copy-paste starting point)

```tsx
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, staticFile, delayRender, continueRender, cancelRender, interpolate, spring, Easing } from "remotion";
import { useEffect, useState, useMemo } from "react";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import type { JobOverlaysProps } from "./_jobOverlaysContract";

loadInter("normal", { weights: ["400", "700", "800", "900"], subsets: ["latin"] });

type Word = { word: string; start: number; end: number };
type Transcript = { words: Word[]; text: string; language: string };

const useJobJson = <T,>(path: string): T | null => {
  const [data, setData] = useState<T | null>(null);
  const [handle] = useState(() => delayRender(`Loading ${path}`));
  useEffect(() => {
    fetch(staticFile(path)).then(r => r.json()).then((j: T) => {
      setData(j); continueRender(handle);
    }).catch(cancelRender);
  }, []);
  return data;
};

const findWord = (
  ws: Word[], search: string, occurrence = 1
): Word | null => {
  let n = 0;
  for (const w of ws) {
    if (w.word.toLowerCase().replace(/[^\w]/g, "") === search.toLowerCase()) {
      n += 1;
      if (n === occurrence) return w;
    }
  }
  return null;
};

export const JobOverlays: React.FC<JobOverlaysProps> = ({ jobPublicPath, fps }) => {
  const transcript = useJobJson<Transcript>(`${jobPublicPath}/transcript.json`);
  if (!transcript) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Beat 1: example */}
      {/* Beat 2: example */}
    </AbsoluteFill>
  );
};

export default JobOverlays;
```

Build outward from there.

---

## 11. Edit types — kinds of moves you can make (NOT a component library)

The pipeline does NOT ship a shared component library (no `<HammerHeadline />`
import you reuse across jobs). That would make every video look the same,
which is the opposite of what we want — each video should feel bespoke.

Instead, this section is a CATALOG of edit types. When authoring overlays.tsx
for a new job, scan this list, pick what serves the script, then BUILD IT
FRESH inline. Each one is a pattern you re-derive, not a snippet you import.

### Cards
- **Hook overlay** — top-third, ~3-5s, brand-pill or outlined text. Branded color, single sentence, hard cut off. Sets the promise.
- **Pivot card** — full-screen flash, ≤1s, hard on/off. Lands the structural moment (WRONG, REVEAL, NO). Pair with SFX.
- **Citation card** — top or corner, 2-3s, dark backing pill, monospace serif. Authority-cite a source, statute, study. Pair with the spoken reference.
- **Story card** — full-screen, 2-4s, image background + text overlay. For "let me show you" moments.
- **End card / brand lockup** — last 1-2s, brand pill + logo + URL. Anchored at 50-65% (above captions, below face).

### Captions
- **Standard burned-in captions** — Layer 1 default for dialogue-led work when captions are enabled. Intentional no-caption work does not add placeholders. **Do not modify an enabled caption track per-job** — its motion, layout, and timing are globally consistent. Brand color/font swap via `style_directives.json` (Layer 2). For bespoke kinetic emphasis, author an ADDITIVE element (below) in overlays.tsx, don't reach into the caption track.
- **Word-pop emphasis** — when a power word is spoken, briefly enlarge + color-shift it in the caption track. Pair with Word-pop SFX (typewriter strike or click).
- **Caption suppression** — for full-screen card moments, optionally suppress captions so the card stands alone.
- **Phase-up impact word** — at a single key transcript word, render a separate big-text element above the caption track that fades + Y-translates in (4-6 frames), holds for 0.6-1.2s, fades out. The actual caption track keeps running underneath unmodified. Use ONCE per video max — saves the "one moving thing" budget for the moment that earns it.

### Motion
- **Wobble** (Layer 1, free) — 2-3px subtle drift on cards. Kills "static graphic" feel.
- **Breathe** (Layer 1, free) — ±1.2% scale pulse on cards.
- **Drift** (Layer 1, free) — slow one-way 8-12px translation, "camera push" feel.
- **Snap-in** — quick spring entrance (8 frames, BOUNCY config) for accent elements.
- **Fade-in/fade-out** — 6-9 frame ramp for cards entering/exiting.

### Anchored beats
- **Word-anchored card** — card fires WHEN a specific word is spoken. Use `findWord` (with caution — see §5.1).
- **Range-anchored card** — card spans from word A to word B. Use `findRange`.
- **Sentence-anchored card** — fires for the full duration of a sentence (find first + last word of the sentence).
- **Beat sheet anchored** — pre-defined timestamps from the script's beat sheet.

### Audio overlays
- **SFX punch** — short impact at a specific frame (stamp slam, gavel, click). See `sfx_guide.md`.
- **Audio bed** — low-level music/ambient under dialogue (see `audio_bed.py`).
- **Audio replace** — TTS replaces avatar audio for one beat (see `patch_audio.py`).

### When you DON'T add an edit
**The avatar's voice + standard captions already carry the script.** Add an
overlay only when:
- A specific word/concept needs visual emphasis the audio can't give
- An authority signal (citation, brand) deserves visual reinforcement
- A structural beat (hook, pivot, payoff) needs visual punctuation

Default to fewer overlays. Each one earns its place.

---

## 12. Patterns invented on the job (worth re-using)

These came out of specific jobs and proved out — generalizable but should be
freshly authored each time, not imported.

### 12.1 Loop-seal — open and close on identical visuals
Open the video on a distinctive image (e.g. a textured background card).
Close it on the SAME image. TikTok auto-replays loop seamlessly when the
last frame matches the first — compounds watch-time.

Implementation: render the same Img twice — once at [00:00, ~1.4s] as a
fade-out hook overlay, once at the final [-1s, end] as a fade-in close.

### 12.2 Word-pop with SFX
At the moment a power word is spoken, simultaneously:
- Caption renders that word at 1.4× size in brand-active color (Layer 1
  caption already does color; add the size pulse in overlays.tsx via a
  word-anchored Sequence)
- A short SFX strikes (typewriter, click, ping) — see `sfx_guide.md` §4

Two reinforcement channels (visual + audio) on the same word land it 3×
harder than either alone. Use SPARINGLY — once per script max.

### 12.3 Hook-as-overlay (never prepend)
**Never prepend a hook card to the avatar video.** Always layer it as a
1.4-second fade-out OVERLAY while the avatar's audio plays underneath.

Why: prepending shifts every transcript timestamp by the hook duration,
breaks word-anchored overlays downstream, and forces a re-transcribe.
Layering as an overlay leaves the avatar's audio + transcript untouched.

### 12.4 Pivot card flash with SFX-on-frame-zero
For sharp corrective beats (WRONG / NOPE / WAIT), use a ≤0.7s full-screen
card with the SFX firing on frame 0 of the Sequence. The audio + visual +
spoken word all hit the same frame — reads as a slap.

```tsx
<Sequence from={wrongStartFrame} durationInFrames={Math.round(0.6 * fps)}>
  <FlashCard /> {/* image + bold WRONG text */}
  <Audio src={staticFile(`${jobPublicPath}/sfx/stamp_slam.mp3`)} />
</Sequence>
```

### 12.5 Textured background card — the primitive

The base recipe behind both the Stat-Reveal Card (§12.6) and the Pull-Quote
Card (§12.7). A 4-6 second full-screen takeover with a generated textured
background, subtle analog jitter, entrance whoosh, and a centered content
slot. The aesthetic is "tactile object" not "UI overlay."

**Identified:** Jen Moff job (2026-05-12). Stat card + pull-quote card both
use this primitive; the only difference is what's *on* the card.

**When to use:** mid-script beat that needs to break out of avatar-talking-
head for 4-6 seconds and land a specific moment with weight (a stat, a
quote, a name, an image). Limit ≤2 per video; more = the format reads as
"slideshow" not "video."

**When NOT to use:** anything <3s (use §12.4 flash instead), or anything
>8s (becomes its own scene — author from scratch).

**Smart-variable defaults** (override the row per brand):

| Variable | Default | Alts |
|---|---|---|
| `bg.kind` | `paper` (gpt-image-2 aged off-white) | `linen`, `wood`, `gradient`, `solid`, `glass`, `metal` |
| `bg.palette` | warm cream / sepia stain | cold blue, monochrome noir, brand-custom |
| `bg.path` | `images/stat_card_bg.png` (reusable across cards in same job) | per-card unique |
| `vignette` | radial dark-warm @ edges | flat (off), light-bloom @ center |
| `jitter.kind` | gate-weave (analog film projector) | none, paper-shake, digital-glitch |
| `jitter.amp_px` | ±2 px | ±0 (off), ±5 (heavy) |
| `flicker.amp` | 4% opacity bounce @ 38 Hz | 0% (off), 8% (heavy) |
| `entrance.duration` | 0.35s fade + slide | 0.5s, 0.7s |
| `exit.duration` | 0.45s fade | 0.6s |
| `entrance.sfx` | `whoosh.mp3` | `camera_shutter.mp3`, `paper_slide.mp3`, none |
| `entrance.sfx_volume` | 0.55 | 0.4 – 0.7 |

**Code skeleton:**

```tsx
const Card: React.FC<{
  jobPublicPath: string;
  width: number;
  height: number;
  durationFrames: number;
  bgPath?: string;
  children: React.ReactNode;
}> = ({ jobPublicPath, width, height, durationFrames,
        bgPath = "images/stat_card_bg.png", children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const cardIn  = interpolate(frame, [0, Math.round(fps * 0.35)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic) });
  const cardOut = interpolate(frame, [durationFrames - Math.round(fps * 0.45), durationFrames],
    [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cardAlpha = Math.min(cardIn, cardOut);

  const jx = Math.sin(t * 11.3) * 1.6 + Math.sin(t * 27.7) * 0.9;
  const jy = Math.sin(t * 9.1 + 1.7) * 1.4 + Math.sin(t * 31.2 + 2.3) * 0.7;
  const flicker = 1 - Math.abs(Math.sin(t * 38.0)) * 0.04;

  return (
    <AbsoluteFill style={{
      opacity: cardAlpha * flicker,
      transform: `translate(${jx}px, ${jy}px)`,
    }}>
      <Img src={staticFile(`${jobPublicPath}/${bgPath}`)}
           style={{ position:"absolute", inset:0, width:"100%", height:"100%",
                    objectFit:"cover" }} />
      <div style={{ position:"absolute", inset:0, background:
        "radial-gradient(ellipse at center, rgba(255,239,210,0) 0%, rgba(120,80,40,0.18) 70%, rgba(60,35,15,0.42) 100%)"
      }} />
      {children}
    </AbsoluteFill>
  );
};
```

Mint the background image once per job (re-use across stat-card + pull-
quote when the aesthetics match):

```bash
uv run python agent/tools/generate_image.py \
    --job <id> --name stat_card_bg --model gpt-image-2 \
    --aspect-ratio 2:3 --quality high \
    --prompt "Aged off-white academic paper texture, vintage 1970s journal
              page, warm cream parchment, subtle fiber grain, light foxing
              spots at edges, soft sepia shadows. ABSOLUTELY NO TEXT, no
              words, no letters, no numbers anywhere. Pure paper texture
              only. Photographic close-up, soft natural lighting."
```

Always pair the card entrance with a whoosh (§12.5 default) OR a
camera-shutter for a more clinical aesthetic (legal/medical brands).
Don't fire two entrance SFX simultaneously.

### 12.6 Stat-Reveal Card

§12.5 base + a kinematic-typography sequence for a stat reveal. Used for
data-anchored signature moments (e.g. *"Tasha Eurich found 95% of us
think we're self-aware, only 10-15% actually are"*).

**Identified:** Jen Moff job (2026-05-12) — applied to the Eurich HBR 2018
stat.

**When to use:** the script names a number that *is* the signature
element (per vision.md). The card gives the number visual weight
proportional to its rhetorical weight. If the stat is a passing reference,
DON'T use this — let the caption do the work.

**Smart-variable defaults:**

| Variable | Default | Notes |
|---|---|---|
| `eyebrow.text` | `Did you know?` | `Per the data:`, `The research:`, `Fact:`, etc. |
| `eyebrow.color` | brand rust | matched to brand palette |
| `primary.value` | the big number (e.g. `95%`) | always anchor on the *spoken* word's start |
| `primary.font` | serif 900 italic, height × 0.18-0.20 | sans-black for tech brands |
| `primary.spring` | damping 10, stiffness 220, mass 0.7 | softer spring for vulnerability-coded brands |
| `secondary.value` | contrast number (e.g. `10-15%`) | optional; omit for single-stat reveals |
| `secondary.color` | brand active (rust/oxblood) | contrast vs primary |
| `subline.text` | one descriptive phrase per number | uppercase tracking-wide |
| `citation.text` | `<Source> · <Pub> <Year>` | always cite; appears bottom-fixed |
| `sfx.primary_drop` | `click.mp3` | camera_shutter for clinical brands |
| `sfx.secondary_drop` | `click.mp3` | same |
| `sfx.ambient` | `film_camera_roll.mp3` looped, vol 0.18 | optional; sells the analog aesthetic |

**Beat structure:**
- t=0: eyebrow fades in
- t=spoken-word-start of primary number: spring + click
- t=secondary-word-start: connector ("but only…") fades in
- t=spoken-word-start of secondary number: spring + click + primary
  softens to ~70% opacity
- t=close-word + ~0.5s: citation strip fades in

When the script has only ONE number, drop the secondary block. When the
script has THREE numbers, add a third spring beat rather than nesting
two — the card has room for ~3 stat lines max before it reads cluttered.

### 12.7 Pull-Quote Card

§12.5 base + word-by-word quote reveal anchored to transcript timestamps.
Used to land a paradox, an aphorism, or a co-sign moment.

**Identified:** Jen Moff job (2026-05-12) — applied to *"sometimes the
more well-crafted your argument, the more likely you are to lose."*

**When to use:** the script contains a single self-contained sentence (or
two) that lands harder when read than when heard. The card gives the
reader 4-6 seconds to internalize the line while it's also being spoken.
Especially powerful when the speaker is *quoting someone else* — the
attribution eyebrow grounds the credibility.

**When NOT to use:** the quote is longer than ~18 words (won't fit; split
into two cards or skip). The quote IS the avatar's own observation in
first-person — feels self-aggrandizing on a card. The quote has no
distinct rhetorical punch (then it's just a caption with extra steps).

**Smart-variable defaults:**

| Variable | Default | Alts |
|---|---|---|
| `attribution.text` | `— <Brand>` | `— <Person>`, omitted entirely |
| `attribution.position` | top (eyebrow) | bottom-right, none |
| `quote.font` | serif 900 italic | sans-condensed-black, slab-serif |
| `quote.size` | height × 0.060 (8-12 word quote) | scale down for longer |
| `quote.line_height` | 1.12 | tighter (0.95) for very long quotes |
| `quote.color` | near-black ink | brand-dark, never pure black |
| `quote.marks` | open + close curly quotes in muted brand color | none for aphorisms |
| `reveal.mode` | word-by-word spring | line-by-line, all-at-once-then-emphasize |
| `reveal.spring` | damping 14, stiffness 200, mass 0.5 | softer/faster as needed |
| `final_word.treatment` | rust + 1.18× scale slam | white-glow, no-emphasis |
| `sfx.typing` | `keyboard_typing.mp3` ONE play, vol 0.30 | per-word `typewriter_strike` (heavier) |
| `sfx.final_word` | `thud.mp3` if rust slam, vol 0.7 | none if no-emphasis |

**Critical: filter `transcript.words` by `start >= firstWord.start &&
start <= lastWord.start`** to get the exact spoken-word slice (don't try
to split the quote text manually — anchor to the transcript). Each word
spans in at its own `start`. Final word ("lose", "now", "everything") gets
the slam treatment.

### 12.8 Brand End-Card

Last 2-4 seconds. Full-screen brand lockup: name + tagline + URL +
optional arrow. The "ad-tag" that closes the loop. Aesthetically
*different* from §12.5 — usually solid dark-warm or solid paper-light to
contrast against the textured cards earlier in the video.

**Identified:** Jen Moff job (2026-05-12) — JEN MOFF / *Make your story
worth telling.* / thejenmoff.com →

**When to use:** every brand-driven video. Skip ONLY for editorial pieces
where the brand-drop is verbal-only.

**Smart-variable defaults:**

| Variable | Default | Alts |
|---|---|---|
| `layout` | centered-stacked | split-half (logo+URL side-by-side), full-bleed-with-mark |
| `backdrop.kind` | solid dark-warm gradient (walnut/ink) | solid paper-light, brand-color, photo-with-tint |
| `title.font` | serif 900 | sans-condensed-black, custom-display |
| `title.text` | brand name | uppercase or title-case to match brand |
| `tagline.text` | brand's *actual website tagline* — verbatim | invented copy reads agent-generated |
| `tagline.font` | serif italic | sans-medium |
| `cta.text` | URL | URL + → arrow, "Book a call →", "Learn more →" |
| `cta.color` | brand active | white, accent |
| `entrance.duration` | 0.5s slide-up + fade | 0.8s for slower brands |
| `hold.duration` | 2.0s after speech ends | 1.5-4s |
| `sfx.entrance` | `whoosh.mp3` | `notification_ping` (warm), none (authority) |

**Anchor:** start the end card on the transcript word that begins the
*verbal* CTA setup (e.g. `wWanna`, `wIf`, `wDiscover`), so the visual
lands while the user is still speaking. Hold beyond the speech-end by
`hold.duration` so the URL reads.

### 12.9 Tasteful B-roll insert (1× per video, max)

A single short cutaway from the avatar to a generated still or short
clip. The MrBeast "wow factor" applied to depth, not quantity — ONE
disproportionately well-sourced visual that grounds a specific noun the
script names.

**When to use:** the script names something concrete that would land
harder if seen than imagined — *a specific document, an object, a place,
a chart, a screenshot, a person's quote framed as text*. Always tied to a
specific spoken noun.

**When NOT to use:** the script is pure abstraction (a coaching insight,
a mindset shift). Forcing b-roll on abstraction reads as stock-image
filler. NEVER use b-roll just because "the video needs more visual
variety" — that's the avatar's job.

**Two variants — pick by the noun:**

| Variant | When | Spec |
|---|---|---|
| **Still + Ken Burns** | static object, document, chart, quote-as-image, screenshot | 1.0–1.8s insert, generate via `generate_image.py` (gpt-image-2 for text-baked, seedream for textures), 2-3% slow zoom-in OR slight pan, soft crossfade in (0.25s) / out (0.4s) |
| **Generated short clip** | object in motion, a place at a moment in time, a hand performing an action | 2.5–4.5s insert, generate via Seedance text-to-video, locked or slow-tracking camera, soft crossfade |

**Smart-variable defaults:**

| Variable | Default | Notes |
|---|---|---|
| `noun.word` | the transcript-anchor word (e.g. *"research"*, *"book"*, *"offsite"*) | resolve via `findWord` |
| `duration` | 1.4s (still) / 3.5s (clip) | never <1.0s — too fast to register |
| `kenburns.zoom` | 1.00 → 1.04 over duration | 1.06 max — heavier reads as stock-doc |
| `kenburns.pan` | static OR ±2% horizontal | never pan + zoom simultaneously |
| `transition.in` | 0.25s crossfade | 0.4s fade-from-black for somber beats |
| `transition.out` | 0.4s crossfade | 0.6s for somber beats |
| `sfx` | optional `paper_rustle` (still) / none (clip) | NEVER a whoosh — that's for cards |

**Code skeleton (still + Ken Burns):**

```tsx
const wNoun = findWord(transcript.words, "research");
if (wNoun) {
  const start = wNoun.start - 0.1;
  const startFrame = Math.round(start * fps);
  const durationFrames = Math.round(1.4 * fps);
  // Ken Burns inside the Sequence: 1.0 → 1.04 over duration
}

<Sequence from={startFrame} durationInFrames={durationFrames}>
  <BrollStill jobPublicPath={jobPublicPath}
              src="images/research_paper_aged.png" />
</Sequence>
```

Mint:
```bash
uv run python agent/tools/generate_image.py \
    --job <id> --name research_paper_aged --model gpt-image-2 \
    --aspect-ratio 2:3 --quality high \
    --prompt "Single photographic close-up of an aged academic research
              paper on a wood desk, warm afternoon light, focused on the
              upper-left header area, slight blur on the lower half.
              ABSOLUTELY NO LEGIBLE TEXT — title and abstract are
              suggested via blurred-type texture only, not readable.
              Photographic, not illustrated."
```

**The rule of one:** a single tasteful b-roll insert lifts the video.
Three inserts make it look like a content-mill explainer. If the script
needs more than one, the script's structural problem isn't b-roll — it's
that the avatar is carrying claims that the visuals should be carrying
instead.

---

## 13. Image asset directory: cards/ vs images/

**Going forward: every generated image goes in `<job_dir>/images/`** (written by
`agent/tools/generate_image.py`). The legacy `<job_dir>/cards/` directory was
used by an earlier `generate_card.py` tool that no longer exists.

**Old jobs:** if you encounter a job with `cards/`, treat it as equivalent to
`images/`. The chung-press job (`chung-press.com-20260505-lk0jn1`) is one such
example — its overlays.tsx references `cards/card_wrong_stamp.png`. New jobs
should reference `images/<name>.png` instead.

If you're touching an old job's overlays.tsx for any reason, optionally move
`cards/*` → `images/` and update the staticFile paths. Otherwise leave it —
the legacy path still resolves via the public symlink.
