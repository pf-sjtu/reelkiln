import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

/**
 * BrandBeat — a full-screen still (generated brand b-roll, cover art, an
 * illustration) shown for a time window with a slow Ken-Burns push + edge fades.
 *
 * The reusable "brand beat" primitive for per-job overlays.tsx: drop generated,
 * brand-style stills at the dead spots (hook / bridge / close) so a demo isn't
 * one continuous UI. Sits wherever the overlay layer sits; the caption layer is
 * z-indexed above it, so captions stay legible on top.
 *
 * `src` should already be a staticFile()-resolved URL. `startSec/endSec` are
 * absolute composition seconds. Use `fit="contain"` for a designed card whose
 * own (white) background should show fully; `cover` for a full-bleed photo.
 */
export const BrandBeat: React.FC<{
  src: string;
  startSec: number;
  endSec: number;
  fadeIn?: number;
  fadeOut?: number;
  fit?: "cover" | "contain";
  fromScale?: number;
  toScale?: number;
  panYPct?: number;
  bg?: string;
}> = ({
  src,
  startSec,
  endSec,
  fadeIn = 0.3,
  fadeOut = 0.3,
  fit = "cover",
  fromScale = 1.0,
  toScale = 1.08,
  panYPct = 0,
  bg = "#ffffff",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < startSec || t > endSec) return null;

  const p = (t - startSec) / Math.max(0.001, endSec - startSec);
  const scale = fromScale + (toScale - fromScale) * p;
  const y = panYPct * p;
  const fadeInF = fadeIn > 0
    ? interpolate(t, [startSec, startSec + fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const fadeOutF = fadeOut > 0
    ? interpolate(t, [endSec - fadeOut, endSec], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;

  return (
    <AbsoluteFill style={{ backgroundColor: bg, opacity: fadeInF * fadeOutF, overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          transform: `scale(${scale.toFixed(4)}) translateY(${y.toFixed(2)}%)`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};
