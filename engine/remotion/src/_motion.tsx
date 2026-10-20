/**
 * _motion.tsx — Layer 1 motion HOCs that any overlay can wrap.
 *
 * See agent/skills/style_layering.md for the WHY (kills "static graphic
 * glued to video" feel by adding subtle ambient motion).
 *
 * Defaults are tuned to be subliminal — slow enough that the eye doesn't
 * track the motion as a feature, but the brain registers "alive."
 *
 * Use ONE wrapper per overlay; stacking reads as over-animated.
 */

import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

// ---------- Wobble: small sinusoidal X/Y drift ----------

export const Wobble: React.FC<{
  children: React.ReactNode;
  amplitudePx?: number;       // peak displacement in pixels (default 2)
  periodSec?: number;          // wave period in seconds (default 4)
  axes?: "x" | "y" | "both";   // which axes drift on (default "both")
  phaseOffset?: number;        // 0-1 — useful when stacking sibling overlays
}> = ({
  children,
  amplitudePx = 2,
  periodSec = 4,
  axes = "both",
  phaseOffset = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const omega = (2 * Math.PI) / periodSec;
  // Slightly different periods on X vs Y so the motion feels organic
  // (perfectly synchronized X+Y reads as a hard linear translation).
  const xPhase = phaseOffset * 2 * Math.PI;
  const yPhase = (phaseOffset + 0.31) * 2 * Math.PI;
  const x = axes === "y" ? 0 : Math.sin(omega * t + xPhase) * amplitudePx;
  const y = axes === "x" ? 0 : Math.sin(omega * 0.84 * t + yPhase) * amplitudePx;
  return (
    <div
      style={{
        transform: `translate(${x.toFixed(3)}px, ${y.toFixed(3)}px)`,
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
};

// ---------- Breathe: subtle scale pulse ----------

export const Breathe: React.FC<{
  children: React.ReactNode;
  scaleAmplitude?: number;   // ± from 1.0 (default 0.012 = ±1.2%)
  periodSec?: number;         // (default 5)
  phaseOffset?: number;       // 0-1
}> = ({
  children,
  scaleAmplitude = 0.012,
  periodSec = 5,
  phaseOffset = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const omega = (2 * Math.PI) / periodSec;
  const phase = phaseOffset * 2 * Math.PI;
  const scale = 1 + Math.sin(omega * t + phase) * scaleAmplitude;
  return (
    <div
      style={{
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: "center center",
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
};

// ---------- Drift: very slow one-way translation ("camera push" feel) ----------

export const Drift: React.FC<{
  children: React.ReactNode;
  fromPx?: { x: number; y: number };
  toPx?: { x: number; y: number };
  durationSec?: number;        // total drift duration; defaults to the parent <Sequence> duration
}> = ({
  children,
  fromPx = { x: 0, y: 0 },
  toPx = { x: 0, y: -8 }, // default: subtle 8px upward push
  durationSec,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const total = durationSec ?? (durationInFrames / fps);
  const progress = Math.min(1, Math.max(0, t / total));
  const x = fromPx.x + (toPx.x - fromPx.x) * progress;
  const y = fromPx.y + (toPx.y - fromPx.y) * progress;
  return (
    <div
      style={{
        transform: `translate(${x.toFixed(3)}px, ${y.toFixed(3)}px)`,
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
};
