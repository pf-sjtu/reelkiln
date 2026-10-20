import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily } from "@remotion/google-fonts/Inter";

const ENTER_DURATION_FRAMES = 10;

const useEnterProgress = (): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame,
    fps,
    config: { damping: 22, stiffness: 180, mass: 0.8 },
  });
};

/**
 * HOOK: big bold caption near the top of the frame in the first ~3-4s of a
 * chunk. Black background pill with white text.
 */
export const Hook: React.FC<{ text: string }> = ({ text }) => {
  const t = useEnterProgress();
  const translateY = interpolate(t, [0, 1], [-30, 0]);
  const opacity = interpolate(t, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: 200,
        paddingLeft: 60,
        paddingRight: 60,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: 72,
          lineHeight: 1.05,
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: "-0.01em",
          color: "#FFFFFF",
          backgroundColor: "rgba(0,0,0,0.86)",
          padding: "26px 32px",
          borderRadius: 18,
          maxWidth: 940,
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          transform: `translateY(${translateY}px)`,
          opacity,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

/**
 * URL PILL: bottom-of-frame call-to-action. Animates in from below.
 */
export const UrlPill: React.FC<{ text: string }> = ({ text }) => {
  const t = useEnterProgress();
  const translateY = interpolate(t, [0, 1], [50, 0]);
  const opacity = interpolate(t, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 60,
          color: "#000000",
          backgroundColor: "#FFD400",
          padding: "20px 40px",
          borderRadius: 999,
          letterSpacing: "0.02em",
          boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
          transform: `translateY(${translateY}px)`,
          opacity,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

/**
 * LOWER THIRD: small citation / source line, lower portion of the frame.
 */
export const LowerThird: React.FC<{ text: string }> = ({ text }) => {
  const t = useEnterProgress();
  const opacity = interpolate(t, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 460,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: 36,
          color: "#FFFFFF",
          backgroundColor: "rgba(0,0,0,0.7)",
          padding: "12px 22px",
          borderRadius: 8,
          letterSpacing: "0.01em",
          opacity,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
