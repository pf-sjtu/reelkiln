import { z } from "zod";

/**
 * The full input-props contract for the Captioned composition.
 *
 * remotion_render.py builds this object from the active job's
 * script.json + transcript.json + final_raw.mp4 path, then passes it
 * via --props=<json> on the CLI.
 *
 * NOTHING in this Remotion project knows about jobs, output dirs, or the
 * agent pipeline — it only sees a self-contained JSON blob. That's what
 * makes the project safe to share across concurrent jobs.
 */

const TokenSchema = z.object({
  /** Matches the field name emitted by agent/tools/elevenlabs.py. */
  word: z.string(),
  /** seconds (absolute, from start of video) */
  start: z.number(),
  end: z.number(),
});

const OverlaySchema = z.object({
  kind: z.enum(["hook", "url", "lower"]),
  text: z.string(),
  /** seconds (absolute) */
  start: z.number(),
  end: z.number(),
});

/**
 * Data-viz overlays — animated stat / chart primitives (see dataviz.tsx). A
 * time-anchored, theme-aware overlay family for explainer / "here's the number"
 * shorts. Themed from the tenant brand pack via `theme`; motion is built in.
 */
const DataVizThemeSchema = z.object({
  font_family: z.string().optional(),          // CSS font family (default Inter)
  color: z.string().optional(),                // big number / primary ink (hex)
  accent: z.string().optional(),               // bar fill / highlight (hex)
  bg: z.string().nullable().optional(),        // card background (null = transparent)
  text_color: z.string().optional(),           // labels (hex)
  radius: z.number().optional(),               // card corner radius px
}).optional();

const DataVizSchema = z.object({
  kind: z.enum(["stat", "bar", "compare"]),
  start: z.number(),                           // seconds (absolute)
  end: z.number(),
  position: z.enum(["top", "center", "lower-third", "bottom"]).optional(),
  theme: DataVizThemeSchema,
  // stat
  value: z.number().optional(),
  label: z.string().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  decimals: z.number().optional(),
  // bar / compare
  series: z.array(z.object({
    label: z.string(),
    value: z.number(),
    color: z.string().optional(),
  })).optional(),
});

/**
 * Caption styling directives — extracted from a Gemini replication_brief and
 * passed verbatim to CaptionPage. All fields optional; missing values fall
 * back to the renderer's tasteful defaults.
 */
const CaptionStyleSchema = z.object({
  font_family: z.string().optional(),       // Google Font name. e.g. "Montserrat".
  weight: z.number().optional(),            // 400-900
  color: z.string().optional(),             // hex
  outline_color: z.string().optional(),     // hex
  outline_width_px: z.number().optional(),  // 1-8 — minimum 4 enforced at render time when no background pill
  background: z.string().nullable().optional(), // CSS color or null
  position: z.enum(["top", "center", "lower-third", "bottom"]).optional(),
  /**
   * Optional override for vertical placement — fraction of canvas height (0=top, 1=bottom).
   * When set, this OVERRIDES the named `position` enum and places the caption's
   * vertical anchor at exactly y = canvas_height * vertical_anchor_ratio.
   * Use this when none of the named positions fit (e.g. 0.67 = "lower-mid", below
   * face but above the bottom-third).
   */
  vertical_anchor_ratio: z.number().min(0).max(1).optional(),
  transform: z.enum(["uppercase", "none", "lowercase", "capitalize"]).optional(),
  active_word_color: z.string().nullable().optional(),
  /**
   * How the active (currently-spoken) word is emphasised:
   *   "color" (default) — the word's TEXT color flips to active_word_color.
   *   "box"             — the word gets a filled marker box (background =
   *                       active_word_color, text = active_word_text_color),
   *                       its stroke suppressed, while inactive words stay
   *                       in `color` with the line's stroke/shadow for legibility.
   *                       This is the "highlighter" preset.
   */
  highlight_mode: z.enum(["color", "box"]).optional(),
  /** Text color of the active word when highlight_mode is "box". Default "#14141A". */
  active_word_text_color: z.string().optional(),
  page_size_words: z.number().optional(),   // 2-5
  switch_ms: z.number().optional(),         // 700-1500
  /**
   * When true (default), split caption pages at sentence-ending punctuation
   * (./?/!/em-dash) so each page contains a complete clause instead of running
   * across sentence boundaries. Set to false to revert to pure time-based grouping.
   */
  break_on_sentence: z.boolean().optional(),
  /**
   * Per-token italic emphasis — token startMs values (from the transcript word
   * timing) that should render in italic. Lets script-asterisk emphasis words
   * (e.g. *that*, *impossible*) be carried into the caption track without
   * needing a separate word-pop overlay. Lookup is exact-ms match against
   * tokens[i].fromMs. Generate this array per-job from the transcript.
   */
  italic_word_starts_ms: z.array(z.number()).optional(),
  /**
   * CSS letter-spacing override applied to caption text (e.g. "-0.025em").
   * Default: "-0.01em". Tighter values (-0.02..-0.03) read more editorial.
   */
  letter_spacing: z.string().optional(),
  /**
   * Caption font size as a fraction of canvas height. Default 0.055 (≈ 60px
   * on a 1080×1920 canvas). Use this in preference to a fixed pixel size so
   * captions scale with aspect ratio and don't overpower the frame.
   */
  font_size_ratio: z.number().optional(),
  /**
   * Optional preflight-supplied hint — average luminance (0-255) sampled in
   * the caption band over the underlying video. The renderer uses it to
   * auto-flip outline color (white outline on dark video, black on light)
   * when outline_color isn't explicitly set.
   */
  background_luminance: z.number().optional(),
  /**
   * Emphasis-typography overrides for italic-marked words (those whose token
   * fromMs is in italic_word_starts_ms). Lets each design brief pick its own
   * emphasis font from typography_palette.md (e.g. Playfair Display Italic
   * for the Editorial palette, Caveat for the High-Touch Personal palette).
   * Default (no override) is Playfair Display Italic at 1.18× body size in
   * mixed-case — see fonts.ts:EMPHASIS_SERIF_FAMILY.
   */
  emphasis_font_family: z.string().optional(),       // Google Font name from fonts.ts FONTS registry
  emphasis_size_multiplier: z.number().optional(),   // default 1.18 — multiplier on caption fontSize
  emphasis_transform: z.enum(["uppercase", "none", "lowercase", "capitalize"]).optional(), // default "none"
  /**
   * Caption-hide ranges in milliseconds. Each [startMs, endMs] pair suppresses
   * captions entirely while a custom overlay (e.g. a big-text stamp like
   * "ETIQUETTE ILLITERATE") carries the words. Lets the overlay stand alone
   * without the default caption underneath.
   */
  hide_ranges_ms: z.array(z.tuple([z.number(), z.number()])).optional(),
}).optional();

/**
 * Optional hard-cut/punch-in timestamps the renderer can use to add visual
 * punctuation that matches the reference video's edit rhythm. Currently only
 * used as metadata in run.md; future renderers can consume it for transitions.
 */
const CutPointsSchema = z.array(z.number()).optional();

/**
 * Optional transforms applied to the BASE video layer (the avatar talking-head
 * before captions / overlays). Generic — driven by style_directives.json so
 * the shared composition stays job-agnostic.
 *
 *   ken_burns: a slow scale ramp across the entire video — adds life to a static
 *              talking-head without B-roll. Typical: 1.00 → 1.04 over the full duration.
 *   punch_zooms: discrete scale spikes at structural pivots (e.g. "But today",
 *                "Here's the thing") — quick scale-up + scale-back for free energy.
 *                durationSec is the total round-trip duration of the spike.
 *   focus_track: keyframed zoom+pan toward an arbitrary FOCAL POINT (x,y) —
 *                the screen-recording demo mechanic. Unlike ken_burns/punch_zooms
 *                (which scale about the CENTER), each keyframe zooms toward a
 *                specific point so the camera can "snap" to the button/panel
 *                being clicked, hold, then ease out. x,y are fractions of the
 *                composition FRAME (0..1); to hold on a target, repeat a keyframe.
 *                fit/background_color control how a non-9:16 source (e.g. a 16:9
 *                screen capture) sits in the vertical frame before the zoom.
 */
const VideoTransformSchema = z.object({
  ken_burns: z.object({
    start_scale: z.number().default(1.0),
    end_scale: z.number().default(1.0),
  }).optional(),
  punch_zooms: z.array(z.object({
    at_sec: z.number(),
    scale: z.number().default(1.05),
    duration_sec: z.number().default(0.4),
  })).optional(),
  focus_track: z.array(z.object({
    at_sec: z.number(),
    scale: z.number().default(1.0),          // ≥1 zooms in
    x: z.number().default(0.5),              // focal point — fraction of frame width  (0=left, 1=right)
    y: z.number().default(0.5),              // focal point — fraction of frame height (0=top, 1=bottom)
    ease: z.enum(["ease", "linear"]).default("ease"),  // "ease" = cubic in-out (default), "linear" = constant
  })).optional(),
  fit: z.enum(["contain", "cover"]).optional(),        // object-fit of the source in the frame (default "contain")
  background_color: z.string().optional(),             // frame bg behind a letterboxed source (default black)
  background_gradient: z.string().optional(),          // CSS gradient for designed wide-source padding
  background_blur_px: z.number().nonnegative().optional(), // contain: blurred cover duplicate behind the full source
  /**
   * Browser-card treatment (the screen-recording demo look). When set, the source
   * video is rendered inside a rounded, shadowed card floating on background_color,
   * instead of filling the frame — so a 16:9 desktop capture reads as a designed
   * shot. focus_track still scales the WHOLE card+bg group, so a "punch" enlarges
   * the card until the targeted region fills the frame (establish → punch).
   */
  frame: z.object({
    inset_pct: z.number().default(4),        // card left/right margin, % of canvas width
    top_pct: z.number().default(20),         // card top edge, % of canvas height
    radius_px: z.number().default(28),       // corner radius
    shadow: z.boolean().default(true),       // soft drop shadow
    chrome: z.enum(["none", "bar"]).default("bar"),  // fake browser top bar with dots
    chrome_label: z.string().optional(),     // text in the chrome bar (e.g. "docuask.ai")
    source_aspect: z.number().default(1.7777),  // width/height of the source capture (card height derives from this)
  }).optional(),
}).optional();

export const CaptionedPropsSchema = z.object({
  /**
   * Path to the stitched video, RELATIVE to agent/remotion/public/.
   * remotion_render.py symlinks each job into public/_jobs/<job-id>/, so
   * a typical value is "_jobs/repti-sitter.com-20260429-hjlndt/final_raw.mp4".
   * Resolved with staticFile() at render time.
   */
  videoPath: z.string(),
  /**
   * The job's public-relative directory path — e.g. "_jobs/teuwen.com-20260504-zgrdxj".
   * Passed through to the per-job <JobOverlays /> component (loaded via the
   * _currentJobOverlays.tsx symlink) so per-job overlays can fetch their own
   * data (motion_plan.json, asset manifests, etc.) via staticFile().
   * Defaults to the dirname of videoPath when not provided.
   */
  jobPublicPath: z.string().optional(),
  /**
   * Path to a JSON transcript file (same format as elevenlabs.py emits),
   * also relative to public/. Optional if captionTokens are provided inline.
   */
  captionsPath: z.string().optional(),
  /** Inline tokens, an alternative to captionsPath. */
  captionTokens: z.array(TokenSchema).optional(),
  /** Total video duration in seconds. */
  durationSeconds: z.number(),
  /** 9:16 by default. */
  width: z.number().default(1080),
  height: z.number().default(1920),
  fps: z.number().default(30),
  /** Hook / lower-third / URL pill overlays. */
  overlays: z.array(OverlaySchema).default([]),
  /** Animated stat / chart overlays (see dataviz.tsx). */
  dataviz: z.array(DataVizSchema).default([]),
  /** Show captions at all. */
  showCaptions: z.boolean().default(true),
  /** Caption styling directives extracted from the reference. */
  captionStyle: CaptionStyleSchema,
  /** Cut-point timestamps from the reference (seconds). */
  cutPoints: CutPointsSchema,
  /**
   * Optional audio bed path RELATIVE TO public/. Mixed under the speech track
   * at `audioBedVolumeDb`. Produced by agent/tools/audio_bed.py via MVSep.
   */
  audioBedPath: z.string().optional(),
  /** Volume of the bed in dB. Negative numbers attenuate. Default -22dB. */
  audioBedVolumeDb: z.number().default(-22),
  /** Optional transforms applied to the base video layer (Ken Burns, punch-zooms). */
  videoTransform: VideoTransformSchema,
});

export type CaptionedProps = z.infer<typeof CaptionedPropsSchema>;
export type CaptionToken = z.infer<typeof TokenSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type DataVizProps = z.infer<typeof DataVizSchema>;
export type CaptionStyle = NonNullable<z.infer<typeof CaptionStyleSchema>>;

export const defaultProps: CaptionedProps = {
  videoPath: "",
  durationSeconds: 30,
  width: 1080,
  height: 1920,
  fps: 30,
  overlays: [],
  dataviz: [],
  showCaptions: true,
  audioBedVolumeDb: -22,
};
