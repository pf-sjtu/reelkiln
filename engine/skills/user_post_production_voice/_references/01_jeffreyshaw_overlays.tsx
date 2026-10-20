/**
 * overlays.tsx — Jeffrey Shaw, LLC (job: jeffreyshaw.com-20260510-wlwxtc)
 *
 * Three overlays, all word-anchored against transcript.json:
 *   1. Hook stacked-rectangle banner    [0:00 – 0:06.7]  top-center (ends on "cost")
 *   2. Lower-third name pill            on "Jeffrey" #1 (~9.98s, holds 3s)
 *   3. Brand lockup card                on "forty"        (~30.54s, holds to end)
 *
 * Brand palette: Florida-elegant cream (#F5EFE3) + gold-foil accent (#C9A961)
 * + warm black (#1C1814) — matches vision.md (cream / walnut / soft sage,
 * Florida-luxury mentor register). Hook stack stays bold black/white per the
 * reference outlier's viral pattern (the reference's hook works BECAUSE the
 * type is bold-block; the brand work is done later by the refined cream
 * pills).
 */

import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  Easing,
} from "remotion";
import { useEffect, useState } from "react";
import type { JobOverlaysProps } from "../../../agent/remotion/src/_jobOverlaysContract";

type TranscriptWord = { word: string; start: number; end: number };
type TranscriptShape = { words: TranscriptWord[]; text: string };

// ---------- Helpers ----------

const useJobJson = <T,>(path: string): T | null => {
  const [data, setData] = useState<T | null>(null);
  const [handle] = useState(() => delayRender(`Loading ${path}`));
  useEffect(() => {
    fetch(staticFile(path))
      .then((r) => r.json())
      .then((j: T) => {
        setData(j);
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
  }, [handle, path]);
  return data;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const findWord = (
  words: TranscriptWord[],
  needle: string,
  occurrence = 1,
): TranscriptWord | null => {
  let seen = 0;
  const target = norm(needle);
  const n = words.length;
  if (occurrence < 0) {
    // count from end
    let want = -occurrence;
    for (let i = n - 1; i >= 0; i--) {
      if (norm(words[i].word) === target) {
        want -= 1;
        if (want === 0) return words[i];
      }
    }
  } else {
    for (const w of words) {
      if (norm(w.word) === target) {
        seen += 1;
        if (seen === occurrence) return w;
      }
    }
  }
  // eslint-disable-next-line no-console
  console.warn(`[overlays] word "${needle}" #${occurrence} not found`);
  return null;
};

// ---------- Style tokens ----------

const COLOR = {
  cream: "#F5EFE3",
  cream_soft: "rgba(245,239,227,0.96)",
  warm_black: "#1C1814",
  warm_black_muted: "rgba(28,24,20,0.72)",
  gold: "#C9A961",
  gold_muted: "rgba(201,169,97,0.85)",
  white: "#FFFFFF",
  black: "#000000",
  shadow: "rgba(0,0,0,0.55)",
};

// ---------- Overlay 1: Hook stacked-rectangle banner ----------
// Matches reference (@strategytips) hook-header style: two stacked
// rectangles, top white-on-black-text-blah, bottom inverted.
// Holds from 0s through end of "cost" (~6.7s with a short trailing fade).

const HookBanner: React.FC<{ width: number; height: number; durationFrames: number }> = ({
  width,
  height,
  durationFrames,
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exitStart = durationFrames - 10;
  const exit = interpolate(frame, [exitStart, durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(enter, exit);
  const translateY = interpolate(frame, [0, 8], [-16, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const padX = Math.round(width * 0.040);
  const padY = Math.round(height * 0.013);
  const fontSizeTop = Math.round(height * 0.044);
  const fontSizeBottom = Math.round(height * 0.030);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.10),
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity,
          transform: `translateY(${translateY}px)`,
          gap: 0,
        }}
      >
        {/* Top rectangle: WHITE background, BLACK bold text */}
        <div
          style={{
            background: COLOR.white,
            color: COLOR.black,
            padding: `${padY}px ${padX}px`,
            fontSize: fontSizeTop,
            fontWeight: 900,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            letterSpacing: "-0.01em",
            lineHeight: 1.0,
            textAlign: "center",
            boxShadow: `0 6px 24px ${COLOR.shadow}`,
            textTransform: "uppercase",
          }}
        >
          NEVER APOLOGIZE
        </div>
        {/* Bottom rectangle: BLACK background, WHITE bold text */}
        <div
          style={{
            background: COLOR.black,
            color: COLOR.white,
            padding: `${padY}px ${padX}px`,
            fontSize: fontSizeBottom,
            fontWeight: 800,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
            letterSpacing: "0.02em",
            lineHeight: 1.0,
            textAlign: "center",
            boxShadow: `0 8px 24px ${COLOR.shadow}`,
            textTransform: "uppercase",
          }}
        >
          for the cost
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Overlay 2: Lower-third name pill (first Jeffrey Shaw mention) ----------

const NamePill: React.FC<{ width: number; height: number; durationFrames: number }> = ({
  width,
  height,
  durationFrames,
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 7], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exitStart = durationFrames - 8;
  const exit = interpolate(frame, [exitStart, durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(enter, exit);
  const translateY = interpolate(frame, [0, 8], [-20, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const scale = interpolate(frame, [0, 8], [0.92, 1.0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Top slot (vacated by the hook banner after 6.7s) — y ~12%, centered,
          fully opaque, larger than v1. Stays clear of the caption band (~84%). */}
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.12),
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity,
          transform: `translateY(${translateY}px) scale(${scale})`,
          transformOrigin: "center top",
        }}
      >
        <div
          style={{
            background: COLOR.cream,
            color: COLOR.warm_black,
            padding: `${Math.round(height * 0.024)}px ${Math.round(width * 0.07)}px`,
            border: `2px solid ${COLOR.gold}`,
            borderRadius: Math.round(height * 0.006),
            boxShadow: `0 14px 36px ${COLOR.shadow}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: Math.round(height * 0.008),
            maxWidth: Math.round(width * 0.86),
          }}
        >
          {/* Gold divider line above name */}
          <div
            style={{
              width: Math.round(width * 0.14),
              height: 2,
              background: COLOR.gold,
              marginBottom: Math.round(height * 0.004),
            }}
          />
          <div
            style={{
              fontSize: Math.round(height * 0.050),
              fontWeight: 700,
              fontFamily: '"Playfair Display", "Times New Roman", Georgia, serif',
              letterSpacing: "0.02em",
              lineHeight: 1.0,
              textAlign: "center",
            }}
          >
            JEFFREY SHAW
          </div>
          <div
            style={{
              fontSize: Math.round(height * 0.022),
              fontWeight: 600,
              fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              letterSpacing: "0.14em",
              color: COLOR.gold,
              textTransform: "uppercase",
              textAlign: "center",
            }}
          >
            40 yrs serving the ultra-wealthy
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Overlay 3: Brand lockup card (closing CTA) ----------

const BrandLockup: React.FC<{
  jobPublicPath: string;
  width: number;
  height: number;
  durationFrames: number;
}> = ({ jobPublicPath, width, height, durationFrames }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const translateY = interpolate(frame, [0, 8], [18, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: enter }}>
      {/* Anchored at ~58% down — above captions band, below the face */}
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.58),
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div
          style={{
            background: COLOR.cream,
            color: COLOR.warm_black,
            padding: `${Math.round(height * 0.024)}px ${Math.round(width * 0.06)}px`,
            borderRadius: Math.round(height * 0.005),
            border: `1px solid ${COLOR.gold}`,
            textAlign: "center",
            boxShadow: `0 14px 36px ${COLOR.shadow}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: Math.round(height * 0.010),
            maxWidth: Math.round(width * 0.82),
          }}
        >
          {/* Gold divider line above name */}
          <div
            style={{
              width: Math.round(width * 0.18),
              height: 2,
              background: COLOR.gold,
              marginBottom: Math.round(height * 0.005),
            }}
          />
          <div
            style={{
              fontSize: Math.round(height * 0.045),
              fontWeight: 700,
              fontFamily: '"Playfair Display", "Times New Roman", Georgia, serif',
              letterSpacing: "0.02em",
              lineHeight: 1.0,
            }}
          >
            JEFFREY SHAW
          </div>
          <div
            style={{
              fontSize: Math.round(height * 0.020),
              fontWeight: 500,
              fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              letterSpacing: "0.16em",
              color: COLOR.gold,
              textTransform: "uppercase",
              marginTop: Math.round(height * -0.002),
            }}
          >
            Sell to the Rich
          </div>
          <div
            style={{
              fontSize: Math.round(height * 0.024),
              fontWeight: 500,
              fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              letterSpacing: "0.04em",
              color: COLOR.warm_black_muted,
              marginTop: Math.round(height * 0.006),
            }}
          >
            jeffreyshaw.com
          </div>
          {/* Gold divider line below */}
          <div
            style={{
              width: Math.round(width * 0.18),
              height: 2,
              background: COLOR.gold,
              marginTop: Math.round(height * 0.005),
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Composition ----------

export const JobOverlays: React.FC<JobOverlaysProps> = ({
  jobPublicPath,
  durationSeconds,
  width,
  height,
  fps,
}) => {
  const transcript = useJobJson<TranscriptShape>(`${jobPublicPath}/transcript.json`);
  if (!transcript) return null;

  // Beat 1: Hook banner — 0s through end of "cost" (with 200ms tail pad)
  const costWord = findWord(transcript.words, "cost");
  const hookEndSec = costWord ? costWord.end + 0.2 : 6.7;
  const hookStartFrame = 0;
  const hookDurationFrames = Math.round(hookEndSec * fps);

  // Beat 2: Name pill — first "Jeffrey" mention, holds 3s
  const jeffreyFirst = findWord(transcript.words, "Jeffrey", 1);
  const nameStartFrame = jeffreyFirst ? Math.round(jeffreyFirst.start * fps) : null;
  const nameDurationFrames = Math.round(3.0 * fps);

  // Beat 3: Brand lockup — anchored to "forty" (the CTA setup), holds to end
  const fortyWord = findWord(transcript.words, "forty");
  const lockupStartFrame = fortyWord ? Math.round(fortyWord.start * fps) : null;
  const lockupDurationFrames =
    lockupStartFrame !== null
      ? Math.round(durationSeconds * fps) - lockupStartFrame
      : 0;

  return (
    <AbsoluteFill>
      <Sequence from={hookStartFrame} durationInFrames={hookDurationFrames}>
        <HookBanner width={width} height={height} durationFrames={hookDurationFrames} />
      </Sequence>

      {nameStartFrame !== null && (
        <Sequence from={nameStartFrame} durationInFrames={nameDurationFrames}>
          <NamePill width={width} height={height} durationFrames={nameDurationFrames} />
        </Sequence>
      )}

      {lockupStartFrame !== null && lockupDurationFrames > 0 && (
        <Sequence from={lockupStartFrame} durationInFrames={lockupDurationFrames}>
          <BrandLockup
            jobPublicPath={jobPublicPath}
            width={width}
            height={height}
            durationFrames={lockupDurationFrames}
          />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

export default JobOverlays;
