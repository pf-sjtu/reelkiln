/**
 * Minimal "text-card-over-video" composition.
 *
 * Reproduces the classic IG/TikTok meme styling: solid white rounded
 * rectangle holding two stacked paragraph blocks, each with a bold label
 * and a body line. Used by concept 10 (first-client laughter) and any
 * future concept that wants the same look.
 *
 * Props are passed in via --props at render time, see
 * pipeline/render_textcard.ts (or `remotion render` CLI).
 */
import {
  AbsoluteFill,
  staticFile,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { z } from "zod";

loadInter("normal", { weights: ["400", "600", "700"], subsets: ["latin"] });

export const TextCardBlockSchema = z.object({
  label: z.string(),       // e.g. "Year 1:"
  body: z.string(),        // e.g. "'I'm so honored to be your coach.'"
});

export const TextCardPropsSchema = z.object({
  videoSrc: z.string(),                // absolute or staticFile path
  blocks: z.array(TextCardBlockSchema),
  durationSeconds: z.number().default(6),
  width: z.number().default(720),
  height: z.number().default(1280),
  fps: z.number().default(30),
  // Vertical position of the card centre, 0..1 of frame height.
  cardCenterY: z.number().default(0.62),
});

export type TextCardProps = z.infer<typeof TextCardPropsSchema>;

export const defaultTextCardProps: TextCardProps = {
  videoSrc: "",
  blocks: [
    { label: "Year 1:", body: "'I'm so honored to be your coach.'" },
    { label: "Year 3:", body: "'girl you're being dramatic.'" },
  ],
  durationSeconds: 6,
  width: 720,
  height: 1280,
  fps: 30,
  cardCenterY: 0.62,
};

export const TextCard: React.FC<TextCardProps> = ({
  videoSrc,
  blocks,
  cardCenterY,
}) => {
  const { width, height } = useVideoConfig();

  // Hard-on card — no fade-in. Card sits there for the full loop so
  // replay-on-loop continuity isn't broken by a fade between iterations.
  const cardOpacity = 1;

  // Card sizing — match the IG meme proportions (≈85% frame width, generous
  // padding, gentle rounded corners).
  const cardWidth = Math.round(width * 0.86);
  const padding = Math.round(width * 0.045);
  const radius = Math.round(width * 0.022);

  // Body sizing — tuned so two paragraph blocks read comfortably at thumb
  // scroll speed without crowding the card.
  const labelSize = Math.round(width * 0.045);
  const bodySize = Math.round(width * 0.042);
  const lineHeight = 1.28;
  const blockGap = Math.round(width * 0.028);

  // Allow absolute URLs as-is; treat any other path as relative to public/.
  const resolvedSrc = /^(https?:|file:|data:)/.test(videoSrc)
    ? videoSrc
    : staticFile(videoSrc);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Video src={resolvedSrc} muted={false} />

      {/* The white text card, centered horizontally, positioned vertically
          by cardCenterY (0..1 of frame height). */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: `${cardCenterY * 100}%`,
            transform: "translateY(-50%)",
            width: cardWidth,
            backgroundColor: "#ffffff",
            borderRadius: radius,
            padding: `${padding}px ${padding * 1.1}px`,
            fontFamily: "Inter, system-ui, sans-serif",
            color: "#0a0a0a",
            opacity: cardOpacity,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          {blocks.map((b, i) => (
            <div
              key={i}
              style={{
                marginBottom: i === blocks.length - 1 ? 0 : blockGap,
                lineHeight,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: labelSize,
                  letterSpacing: "-0.005em",
                }}
              >
                {b.label}
              </span>{" "}
              <span
                style={{
                  fontWeight: 400,
                  fontSize: bodySize,
                  letterSpacing: "-0.005em",
                }}
              >
                {b.body}
              </span>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
