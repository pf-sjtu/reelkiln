import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { TikTokPage } from "@remotion/captions";
import { DEFAULT_FONT_FAMILY, EMPHASIS_SERIF_FAMILY, resolveFontFamily } from "./fonts";
import type { CaptionStyle } from "./schema";

const DEFAULTS = {
  active_word_color: "#96cade", // Brand sky-blue — matches the hook pill + brand lockup pill background for visual cohesion across the whole video. Was #FFD400 yellow originally.
  color: "#FFFFFF",
  outline_color: "#000000",
  outline_width_px: 3,
  weight: 800,
  position: "lower-third" as const,
  vertical_anchor_ratio: 0.65, // Anchor caption baseline at 65% down — well clear of the avatar's face/torso, well above the bottom platform UI band. Overrides position enum when set.
  transform: "uppercase" as const,
  font_size_ratio: 0.028, // ≈ 54px on 1920h. The previous 0.055 (~105px) was 2× too dominant for talking-head content where the face is the focus, not the words.
};

// Force minimum outline when there's no background pill. I (Claude) cannot
// see the rendered output — captions on a busy or mid-luminance background
// disappear without a thick stroke. This is a guardrail against my blindness.
const MIN_OUTLINE_WIDTH_PX_NO_PILL = 4;
const MIN_OUTLINE_WIDTH_PX_FONT_SIZE_RATIO = 0.055; // scale outline with size

/** Luma (0-255) of a #RRGGBB hex color. Falls back to 200 (light) on parse failure. */
const relativeBrightness = (hex: string): number => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!m) return 200;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  // Rec. 601 luma — close enough for outline-flip decisions.
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const verticalPlacement = (
  position: NonNullable<CaptionStyle["position"]>,
  height: number,
  verticalAnchorRatio?: number,
): { justifyContent: React.CSSProperties["justifyContent"]; paddingTop: number; paddingBottom: number } => {
  // Explicit override wins — anchor caption at exactly y = height * ratio.
  // Use flex-start + paddingTop so the caption baseline lands at the requested ratio.
  if (typeof verticalAnchorRatio === "number") {
    return {
      justifyContent: "flex-start",
      paddingTop: Math.round(height * verticalAnchorRatio),
      paddingBottom: 0,
    };
  }
  switch (position) {
    case "top":
      return { justifyContent: "flex-start", paddingTop: Math.round(height * 0.18), paddingBottom: 0 };
    case "center":
      return { justifyContent: "center", paddingTop: 0, paddingBottom: 0 };
    case "bottom":
      return { justifyContent: "flex-end", paddingTop: 0, paddingBottom: Math.round(height * 0.06) };
    case "lower-third":
    default:
      return { justifyContent: "flex-end", paddingTop: 0, paddingBottom: Math.round(height * 0.18) };
  }
};

export const CaptionPage: React.FC<{
  page: TikTokPage;
  style?: CaptionStyle;
}> = ({ page, style }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;
  const absoluteTimeMs = page.startMs + currentTimeMs;

  // Optional: hide_ranges_ms = list of [startMs, endMs] pairs during which the
  // caption is suppressed entirely. Used for overlay beats where a custom
  // graphic carries the words (e.g. an ETIQUETTE-ILLITERATE stamp).
  const hideRanges = style?.hide_ranges_ms as Array<[number, number]> | undefined;
  if (hideRanges) {
    for (const [s, e] of hideRanges) {
      if (absoluteTimeMs >= s && absoluteTimeMs < e) return null;
    }
  }

  const fontFamily = style?.font_family ? resolveFontFamily(style.font_family) : DEFAULT_FONT_FAMILY;
  const weight = style?.weight ?? DEFAULTS.weight;
  const inactiveColor = style?.color ?? DEFAULTS.color;
  const activeColor = style?.active_word_color ?? DEFAULTS.active_word_color;
  const transform = style?.transform ?? DEFAULTS.transform;
  const highlightMode = style?.highlight_mode ?? "color";
  const activeTextColor = style?.active_word_text_color ?? "#14141A";
  const background = style?.background; // null/undefined = none
  const position = style?.position ?? DEFAULTS.position;
  const letterSpacing = style?.letter_spacing ?? "-0.01em";
  const italicMs = new Set(style?.italic_word_starts_ms ?? []);

  const fontSizeRatio = style?.font_size_ratio ?? DEFAULTS.font_size_ratio;
  const fontSize = Math.round(height * fontSizeRatio);

  // Outline color: explicit user value WINS. Otherwise, auto-pick based on the
  // TEXT color's brightness — outline contrasts the text, not the background.
  // (Background luminance is captured for future debugging, but the outline's
  // job is to keep the text legible regardless of background.)
  // Convention: dark text → light outline, light text → dark outline.
  let outlineColor = style?.outline_color;
  if (!outlineColor) {
    const lum = relativeBrightness(inactiveColor);
    outlineColor = lum > 140 ? "#000000" : "#FFFFFF";
  }

  // Outline width: enforce minimum unless there's a background pill (which
  // suppresses the stroke anyway). Scale with font size so the stroke still
  // reads at smaller sizes.
  // Explicit `outline_width_px: 0` opts OUT of the blindness guardrail — a
  // deliberate "no stroke" choice (e.g. the clean / editorial / handwritten
  // presets, which lean on a strong drop-shadow instead).
  const requestedOutline = style?.outline_width_px ?? DEFAULTS.outline_width_px;
  const explicitZeroOutline = style?.outline_width_px === 0;
  const minOutline = background || explicitZeroOutline
    ? 0
    : Math.max(MIN_OUTLINE_WIDTH_PX_NO_PILL, Math.round(fontSize * MIN_OUTLINE_WIDTH_PX_FONT_SIZE_RATIO));
  const outlineWidth = background || explicitZeroOutline ? requestedOutline : Math.max(requestedOutline, minOutline);
  // When there's neither a stroke nor a pill, the only thing keeping the text
  // legible on busy footage is the drop-shadow — so make it heavier.
  const noStroke = outlineWidth === 0 && !background;

  const { justifyContent, paddingTop, paddingBottom } = verticalPlacement(position, height, style?.vertical_anchor_ratio ?? DEFAULTS.vertical_anchor_ratio);
  const isVerticalDelivery = width / height <= 0.7;
  const safeLeft = isVerticalDelivery ? Math.round(width * (100 / 1080)) : Math.round(width * (80 / 1080));
  const safeRight = isVerticalDelivery ? Math.round(width * (180 / 1080)) : Math.round(width * (80 / 1080));

  const shadowStrength = noStroke
    ? Math.max(12, Math.round(fontSize * 0.22))
    : Math.max(8, Math.round(fontSize * 0.14));
  const innerStyle: React.CSSProperties = {
    fontFamily,
    fontWeight: weight,
    fontSize,
    lineHeight: 1.18, // bumped from 1.05 — gives wrapped lines breathing room
    textAlign: "center",
    textTransform: transform,
    letterSpacing,
    color: inactiveColor,
    // Drop shadow gives a softer second layer of contrast on top of the stroke.
    // With no stroke (noStroke presets) it's darker/wider — it's the only thing
    // separating the text from busy footage.
    textShadow: noStroke
      ? `0 ${Math.round(fontSize * 0.04)}px ${shadowStrength}px rgba(0,0,0,0.85)`
      : `0 ${Math.round(fontSize * 0.05)}px ${shadowStrength}px rgba(0,0,0,0.55)`,
    WebkitTextStroke: `${outlineWidth}px ${outlineColor}`,
    paintOrder: "stroke fill",
    whiteSpace: "normal", // wrap on whitespace; was "pre-wrap" which preserved literal line breaks too aggressively
    overflowWrap: "break-word",
    wordBreak: "normal",
    maxWidth: "100%",
  };
  if (background) {
    innerStyle.backgroundColor = background;
    innerStyle.padding = `${Math.round(fontSize * 0.25)}px ${Math.round(fontSize * 0.35)}px`;
    innerStyle.borderRadius = Math.round(fontSize * 0.18);
    innerStyle.WebkitTextStroke = "0 transparent"; // pill suppresses outline
    innerStyle.textShadow = `0 ${Math.round(fontSize * 0.025)}px ${Math.round(fontSize * 0.08)}px rgba(0,0,0,0.4)`;
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent,
        alignItems: "center",
        paddingTop,
        paddingBottom,
        // Keep caption glyphs out of the all-platform action rail (x>=920 on a
        // 1080px canvas). The asymmetric inset uses the wider safe content
        // area on the left without squeezing lines into a narrow center box.
        paddingLeft: safeLeft,
        paddingRight: safeRight,
      }}
    >
      <div style={innerStyle}>
        {page.tokens.map((token, i) => {
          const isActive = token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
          // Italic per-token: matches if this token's fromMs is in the italic set.
          // Allow ±2ms tolerance against rounding in the source transcript.
          const isItalic = italicMs.has(token.fromMs)
            || italicMs.has(Math.round(token.fromMs))
            || [...italicMs].some((ms) => Math.abs(ms - token.fromMs) < 2);
          // Emphasized (italic-marked) words render in a contrasting font at a
          // slightly larger size — replacing the color-highlight pattern. The
          // emphasis font is per-job-overridable via captionStyle.emphasis_font_family
          // (see agent/skills/typography_palette.md). Default is Playfair Italic
          // (Editorial palette A).
          const emphasisFamily = style?.emphasis_font_family
            ? resolveFontFamily((style as any).emphasis_font_family)
            : EMPHASIS_SERIF_FAMILY;
          const emphasisSizeMul = style?.emphasis_size_multiplier ?? 1.18;
          const emphasisCasing = style?.emphasis_transform ?? "none";
          const emphasisStyle: React.CSSProperties = isItalic
            ? {
                fontFamily: emphasisFamily,
                fontStyle: "italic",
                fontWeight: 700,
                fontSize: Math.round(fontSize * emphasisSizeMul),
                letterSpacing: "0.005em",
                textTransform: emphasisCasing as React.CSSProperties["textTransform"],
                verticalAlign: "baseline",
              }
            : {};
          // Highlighter ("box") mode: the active word gets a filled marker box
          // (background = activeColor, dark text, no stroke) while inactive words
          // keep `inactiveColor` + the line's stroke/shadow so they stay readable.
          //
          // CRITICAL: EVERY word reserves the SAME inline-block padding (just a
          // transparent background when inactive). If only the active word were
          // padded, its width would change every time the highlight moved, and a
          // center-aligned line would reflow horizontally on each word change —
          // the "jiggle". Constant padding ⇒ constant geometry ⇒ no reflow.
          if (highlightMode === "box") {
            const padV = Math.round(fontSize * 0.05);
            const padH = Math.round(fontSize * 0.12);
            const radius = Math.round(fontSize * 0.12);
            // ONLY the bubble grows — it's a separate layer BEHIND the text that
            // eases in (non-linear scale with a slight overshoot). The text never
            // scales: it stays white, fixed size, with the line's stroke. The
            // wrapper keeps constant padding for ALL words so the active bubble
            // (absolute + transform) changes no layout → no reflow / jiggle.
            const sinceActiveMs = absoluteTimeMs - token.fromMs;
            const bubbleScale = interpolate(sinceActiveMs, [0, 170], [0.9, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.back(1.3)),
            });
            const bubbleColor = activeColor ?? DEFAULTS.active_word_color;
            return (
              <span
                key={`${token.fromMs}-${i}`}
                style={{
                  position: "relative",
                  display: "inline-block",
                  padding: `${padV}px ${padH}px`,
                  color: isActive ? activeTextColor : inactiveColor,
                }}
              >
                {isActive && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundColor: bubbleColor,
                      borderRadius: radius,
                      transform: `scale(${bubbleScale})`,
                      transformOrigin: "center",
                      zIndex: 0,
                    }}
                  />
                )}
                <span style={{ position: "relative", zIndex: 1, ...emphasisStyle }}>
                  {token.text.trim()}
                </span>
              </span>
            );
          }
          return (
            <span
              key={`${token.fromMs}-${i}`}
              style={{
                color: isActive ? activeColor : inactiveColor,
                ...emphasisStyle,
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
