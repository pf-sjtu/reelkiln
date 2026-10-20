/**
 * Generic vertical-video text overlay composition.
 *
 * Renders any number of pill-style text blocks on top of a background
 * video. Each block has its own position (x/y as % of frame), font size,
 * time window, alignment, and weight. Mirrors the white-on-black-rounded-
 * pill aesthetic used by ~80% of viral IG/TikTok hook overlays.
 *
 * Props are passed in via --props at render time.
 */
import {
  AbsoluteFill,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { z } from "zod";

loadInter("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin"] });

export const PillBlockSchema = z.object({
  text: z.string(),                              // \n splits lines
  yPct: z.number().default(0.08),                // 0..1 vertical position (top edge)
  xPct: z.number().default(0.5),                 // 0..1 horizontal CENTER position
  fontSizePct: z.number().default(0.055),        // px = fontSizePct * width
  weight: z.union([z.literal(400), z.literal(600), z.literal(700), z.literal(800)]).default(700),
  startSec: z.number().default(0),
  endSec: z.number().default(9999),
  // px padding inside pill, scaled by width
  padXPct: z.number().default(0.028),
  padYPct: z.number().default(0.014),
  maxWidthPct: z.number().default(0.86),         // pill never exceeds this fraction of frame width
  // Pill background opacity (0..1). Default 0.78 for legibility-over-busy-bg;
  // pass 1.0 for solid black pill.
  bgOpacity: z.number().default(0.78),
});
export type PillBlock = z.infer<typeof PillBlockSchema>;

export const PillCaptionPropsSchema = z.object({
  videoSrc: z.string(),
  blocks: z.array(PillBlockSchema),
  durationSeconds: z.number().default(6),
  width: z.number().default(720),
  height: z.number().default(1280),
  fps: z.number().default(30),
});
export type PillCaptionProps = z.infer<typeof PillCaptionPropsSchema>;

export const defaultPillCaptionProps: PillCaptionProps = {
  videoSrc: "",
  blocks: [
    { text: "Example hook line", yPct: 0.08, xPct: 0.5, fontSizePct: 0.055,
      weight: 700, startSec: 0, endSec: 9999, padXPct: 0.028, padYPct: 0.014,
      maxWidthPct: 0.86, bgOpacity: 0.78 },
  ],
  durationSeconds: 6,
  width: 720,
  height: 1280,
  fps: 30,
};

const Pill: React.FC<{ block: PillBlock; canvasWidth: number; tSec: number }> = ({
  block, canvasWidth, tSec,
}) => {
  // Hard on/off — no fade. The pill is either fully visible inside its
  // window or not rendered at all. This preserves loop continuity for
  // short-form replay (no visible "transition" between loop iterations).
  if (tSec < block.startSec || tSec > block.endSec) return null;
  const opacity = 1;

  const fontSize = block.fontSizePct * canvasWidth;
  const padX = block.padXPct * canvasWidth;
  const padY = block.padYPct * canvasWidth;
  const maxWidth = block.maxWidthPct * canvasWidth;
  const lines = block.text.split("\n");

  return (
    <div
      style={{
        position: "absolute",
        top: `${block.yPct * 100}%`,
        left: `${block.xPct * 100}%`,
        transform: "translateX(-50%)",
        maxWidth,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            backgroundColor: `rgba(0,0,0,${block.bgOpacity})`,
            color: "#ffffff",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: block.weight,
            fontSize,
            lineHeight: 1.18,
            padding: `${padY}px ${padX}px`,
            borderRadius: Math.round(canvasWidth * 0.012),
            marginTop: i === 0 ? 0 : Math.round(canvasWidth * 0.006),
            whiteSpace: "nowrap",
            letterSpacing: "-0.005em",
            textAlign: "center",
            // Subtle text shadow improves legibility on bright/busy backgrounds
            // without changing the visual style.
            textShadow: "0 1px 2px rgba(0,0,0,0.35)",
          }}
        >
          {line || " "}
        </div>
      ))}
    </div>
  );
};

export const PillCaption: React.FC<PillCaptionProps> = ({ videoSrc, blocks }) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const tSec = frame / fps;

  const resolvedSrc = /^(https?:|file:|data:)/.test(videoSrc)
    ? videoSrc
    : staticFile(videoSrc);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Video src={resolvedSrc} muted={false} />
      <AbsoluteFill>
        {blocks.map((b, i) => (
          <Pill key={i} block={b} canvasWidth={width} tSec={tSec} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
