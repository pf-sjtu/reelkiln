/**
 * Sane Spaces / Cena Block — per-job overlays.
 *
 * Layered on top of the avatar talking-head + caption track. Four components:
 *
 *   1. BarkleyLowerThird       (0.0s → 1.3s)  — credibility lower-third on the
 *                                                tight close-up opener. Mirrors
 *                                                the reference video's
 *                                                "from a Harvard-trained career
 *                                                coach" overlay.
 *
 *   2. ClearCard / FrameCard / FinishCard      — 3 full-frame screen-hijack
 *                                                cards on the §12.5 textured-
 *                                                paper primitive. Each replaces
 *                                                the talking-head visuals
 *                                                during the corresponding
 *                                                pillar moment (where seedance
 *                                                hand-morph artifacts are
 *                                                visible). Avatar audio plays
 *                                                under the card.
 *
 *   3. BrandEndCard            (39.58s → end)  — warm walnut gradient brand
 *                                                lockup for the CTA close.
 *
 * Palette D (Coaching Warm) typography:
 *   - body sans: Manrope (sentence case)
 *   - editorial emphasis: Cormorant Garamond Italic
 *   - colors: cream #F5EFE3, terracotta #C2552C, sage #6B8E5A, warm walnut
 */

import {
  AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig,
  staticFile, delayRender, continueRender, cancelRender,
  interpolate, Easing, Img,
} from "remotion";
import { useEffect, useState } from "react";
import type { JobOverlaysProps } from "./_jobOverlaysContract";

// ─── Palette D (Coaching Warm) tokens ────────────────────────────────────────

const CREAM = "#F5EFE3";
const TERRA = "#C2552C";
const SAGE = "#6B8E5A";
const INK = "#2D2018";
const WALNUT_DARK = "#3A2618";
const WALNUT_LIGHT = "#5C4030";

const FONT_BODY = "Manrope";       // pre-loaded in fonts.ts
const FONT_EDITORIAL = "Cormorant Garamond"; // pre-loaded in fonts.ts

// ─── Transcript loader ───────────────────────────────────────────────────────

type Word = { word?: string; text?: string; start: number; end: number };
type Transcript = { words: Word[] };

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
  }, []);
  return data;
};

// ─── Gate-weave textured card primitive (§12.5) ──────────────────────────────

const TexturedCard: React.FC<{
  jobPublicPath: string;
  width: number;
  height: number;
  durationFrames: number;
  fps: number;
  bgPath?: string;
  children: React.ReactNode;
}> = ({
  jobPublicPath, width, height, durationFrames, fps,
  bgPath = "images/pillar_card_bg.png", children,
}) => {
  const frame = useCurrentFrame();
  const t = frame / fps;

  const fadeIn = interpolate(
    frame, [0, Math.round(fps * 0.35)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const fadeOut = interpolate(
    frame, [durationFrames - Math.round(fps * 0.45), durationFrames], [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const alpha = Math.min(fadeIn, fadeOut);

  // Gate-weave analog-projector jitter
  const jx = Math.sin(t * 11.3) * 1.6 + Math.sin(t * 27.7) * 0.9;
  const jy = Math.sin(t * 9.1 + 1.7) * 1.4 + Math.sin(t * 31.2 + 2.3) * 0.7;
  const flicker = 1 - Math.abs(Math.sin(t * 38.0)) * 0.04;

  return (
    <AbsoluteFill
      style={{
        opacity: alpha * flicker,
        transform: `translate(${jx}px, ${jy}px)`,
      }}
    >
      <Img
        src={staticFile(`${jobPublicPath}/${bgPath}`)}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%", objectFit: "cover",
        }}
      />
      {/* Vignette */}
      <div
        style={{
          position: "absolute", inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(255,239,210,0) 0%, rgba(120,80,40,0.18) 70%, rgba(60,35,15,0.45) 100%)",
          pointerEvents: "none",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

// ─── Pillar Card content (eyebrow + big italic name + action sub-line) ──────

const PillarCardContent: React.FC<{
  step: 1 | 2 | 3;
  name: string;
  action: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
}> = ({ step, name, action, height, fps, durationFrames }) => {
  const frame = useCurrentFrame();

  // Stagger entrance of each text element
  const eyebrowIn = interpolate(
    frame, [Math.round(fps * 0.25), Math.round(fps * 0.55)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const eyebrowY = interpolate(
    frame, [Math.round(fps * 0.25), Math.round(fps * 0.55)], [18, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  const nameIn = interpolate(
    frame, [Math.round(fps * 0.45), Math.round(fps * 0.85)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const nameY = interpolate(
    frame, [Math.round(fps * 0.45), Math.round(fps * 0.85)], [24, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  const actionIn = interpolate(
    frame, [Math.round(fps * 0.75), Math.round(fps * 1.15)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "0 8%", textAlign: "center",
      }}
    >
      {/* Eyebrow: "Step 1 of 3" */}
      <div
        style={{
          opacity: eyebrowIn,
          transform: `translateY(${eyebrowY}px)`,
          fontFamily: FONT_BODY,
          fontWeight: 500,
          fontSize: height * 0.022,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: TERRA,
          marginBottom: height * 0.025,
        }}
      >
        Step {step} of 3
      </div>

      {/* Big pillar name in Cormorant Italic */}
      <div
        style={{
          opacity: nameIn,
          transform: `translateY(${nameY}px)`,
          fontFamily: FONT_EDITORIAL,
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: height * 0.18,
          lineHeight: 1.0,
          color: INK,
          textShadow: "0 2px 12px rgba(60,35,15,0.18)",
          marginBottom: height * 0.03,
        }}
      >
        {name}
      </div>

      {/* Action sub-line in Cormorant 500 */}
      <div
        style={{
          opacity: actionIn,
          fontFamily: FONT_EDITORIAL,
          fontWeight: 500,
          fontSize: height * 0.034,
          lineHeight: 1.25,
          color: INK,
          maxWidth: "78%",
        }}
      >
        {action}
      </div>
    </AbsoluteFill>
  );
};

// ─── Barkley credibility lower-third (chunk 0, 0.0–1.3s) ─────────────────────

const BarkleyLowerThird: React.FC<{
  height: number;
  fps: number;
}> = ({ height, fps }) => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(
    frame, [0, Math.round(fps * 0.18)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const fadeOut = interpolate(
    frame, [Math.round(fps * 1.05), Math.round(fps * 1.3)], [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const alpha = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill
      style={{
        opacity: alpha,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-end",
        paddingBottom: height * 0.18, // lower-center, above caption band
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: FONT_EDITORIAL,
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: height * 0.028,
          color: CREAM,
          textAlign: "center",
          maxWidth: "78%",
          letterSpacing: "0.01em",
          textShadow: "0 2px 14px rgba(0,0,0,0.55), 0 0 4px rgba(0,0,0,0.45)",
        }}
      >
        Based on research from the most-cited ADHD researcher alive
      </div>
    </AbsoluteFill>
  );
};

// ─── Brand End-Card (last ~5s) ───────────────────────────────────────────────

const BrandEndCard: React.FC<{
  width: number;
  height: number;
  durationFrames: number;
  fps: number;
}> = ({ height, durationFrames, fps }) => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(
    frame, [0, Math.round(fps * 0.5)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const slideY = interpolate(
    frame, [0, Math.round(fps * 0.5)], [40, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  // URL underline draws in after the rest settles
  const urlIn = interpolate(
    frame, [Math.round(fps * 0.7), Math.round(fps * 1.0)], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      {/* Warm walnut gradient backdrop */}
      <AbsoluteFill
        style={{
          background:
            `radial-gradient(ellipse at 40% 35%, ${WALNUT_LIGHT} 0%, ${WALNUT_DARK} 70%, #1F1108 100%)`,
        }}
      />

      {/* Centered stack */}
      <AbsoluteFill
        style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          textAlign: "center",
          transform: `translateY(${slideY}px)`,
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 500,
            fontSize: height * 0.018,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: TERRA,
            marginBottom: height * 0.025,
            opacity: 0.92,
          }}
        >
          ADHD Coaching · Cena Block
        </div>

        {/* Brand name in Cormorant 700 sentence case */}
        <div
          style={{
            fontFamily: FONT_EDITORIAL,
            fontWeight: 700,
            fontSize: height * 0.085,
            lineHeight: 1.0,
            color: CREAM,
            marginBottom: height * 0.018,
            letterSpacing: "-0.005em",
          }}
        >
          Sane Spaces
        </div>

        {/* Tagline — verbatim brand language */}
        <div
          style={{
            fontFamily: FONT_EDITORIAL,
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: height * 0.028,
            color: CREAM,
            opacity: 0.82,
            marginBottom: height * 0.05,
            maxWidth: "72%",
          }}
        >
          ADHD coaching for high performers.
        </div>

        {/* URL CTA */}
        <div
          style={{
            opacity: urlIn,
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: height * 0.026,
            color: TERRA,
            letterSpacing: "0.04em",
            display: "flex", alignItems: "baseline", gap: height * 0.012,
          }}
        >
          <span>sanespaces.com</span>
          <span style={{ fontSize: height * 0.028, opacity: 0.85 }}>→</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

export const JobOverlays: React.FC<JobOverlaysProps> = ({
  jobPublicPath, width, height, fps, durationSeconds,
}) => {
  const transcript = useJobJson<Transcript>(`${jobPublicPath}/transcript.json`);
  if (!transcript) return null;

  const durationFrames = Math.round(durationSeconds * fps);

  // Anchor times in seconds — derived from the post-densify transcript.
  // Each pillar card spans from just-before the opening word of its sentence
  // to just-after the closing word's end, generously covering the chunk.
  const T = {
    barkley_start: 0.0,
    barkley_dur: 1.3,

    clear_start: 19.90,
    clear_end: 24.50,

    frame_start: 24.50,
    frame_end: 30.40,

    finish_start: 30.40,
    finish_end: 37.50,

    end_card_start: 39.58, // "And if you want..."
    end_card_end: durationSeconds, // hold to the very end
  };

  const toFrames = (sec: number) => Math.max(0, Math.round(sec * fps));
  const durFrames = (a: number, b: number) =>
    Math.max(1, Math.round((b - a) * fps));

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* 1. Barkley credibility lower-third */}
      <Sequence
        from={toFrames(T.barkley_start)}
        durationInFrames={durFrames(T.barkley_start, T.barkley_start + T.barkley_dur)}
      >
        <BarkleyLowerThird height={height} fps={fps} />
      </Sequence>

      {/* 2. Clear pillar card — full-frame hijack */}
      <Sequence
        from={toFrames(T.clear_start)}
        durationInFrames={durFrames(T.clear_start, T.clear_end)}
      >
        <TexturedCard
          jobPublicPath={jobPublicPath}
          width={width}
          height={height}
          fps={fps}
          durationFrames={durFrames(T.clear_start, T.clear_end)}
        >
          <PillarCardContent
            step={1}
            name="Clear"
            action="Dump every worry and to-do onto a piece of paper."
            width={width}
            height={height}
            fps={fps}
            durationFrames={durFrames(T.clear_start, T.clear_end)}
          />
        </TexturedCard>
      </Sequence>

      {/* 3. Frame pillar card — full-frame hijack (includes the 45-min specific) */}
      <Sequence
        from={toFrames(T.frame_start)}
        durationInFrames={durFrames(T.frame_start, T.frame_end)}
      >
        <TexturedCard
          jobPublicPath={jobPublicPath}
          width={width}
          height={height}
          fps={fps}
          durationFrames={durFrames(T.frame_start, T.frame_end)}
        >
          <PillarCardContent
            step={2}
            name="Frame"
            action="3 core tasks · 45-minute slots."
            width={width}
            height={height}
            fps={fps}
            durationFrames={durFrames(T.frame_start, T.frame_end)}
          />
        </TexturedCard>
      </Sequence>

      {/* 4. Finish pillar card — full-frame hijack */}
      <Sequence
        from={toFrames(T.finish_start)}
        durationInFrames={durFrames(T.finish_start, T.finish_end)}
      >
        <TexturedCard
          jobPublicPath={jobPublicPath}
          width={width}
          height={height}
          fps={fps}
          durationFrames={durFrames(T.finish_start, T.finish_end)}
        >
          <PillarCardContent
            step={3}
            name="Finish"
            action="Close unrelated tabs. Cross each one off."
            width={width}
            height={height}
            fps={fps}
            durationFrames={durFrames(T.finish_start, T.finish_end)}
          />
        </TexturedCard>
      </Sequence>

      {/* 5. Brand end-card */}
      <Sequence
        from={toFrames(T.end_card_start)}
        durationInFrames={durFrames(T.end_card_start, T.end_card_end)}
      >
        <BrandEndCard
          width={width}
          height={height}
          fps={fps}
          durationFrames={durFrames(T.end_card_start, T.end_card_end)}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

export default JobOverlays;
