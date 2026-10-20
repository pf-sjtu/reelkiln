import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
  delayRender,
  continueRender,
  cancelRender,
} from "remotion";
import { loadFont as loadCaveat } from "@remotion/google-fonts/Caveat";
import { loadFont as loadEBGaramond } from "@remotion/google-fonts/EBGaramond";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import type { JobOverlaysProps } from "./_jobOverlaysContract";

/**
 * ThigPro — overlays.tsx
 *
 * Aesthetic (user-directed):
 *  - Hand-drawn vibe (Caveat handwriting + EB Garamond serif, sepia ink palette)
 *  - Crumpled cream paper backdrops for notebook overlays
 *  - Gate weave (subtle film-projector jitter) on overlay layer
 *  - Minimalist (single sepia ink, no decorative flourishes)
 *  - L.E.A.D.E.R icons WIGGLE — 2-frame boil animation
 *
 * Beats:
 *  H   0:00 → ~5am          Hook journal + TikTok pill (covers chunk 1 open)
 *  C1  chunk 1 mid          Credibility chip (LCSW · hundreds of founders)
 *  N1  chunks 2 → 3B        Notebook Page 1: flowchart + doom-loop
 *  C2  chunk 4 ("fusion")   ACT citation chip
 *  N2  chunks 5 → mid-6     Notebook Page 2: L.E.A.D.E.R acronym (wiggling icons)
 *  K   "leader" word        Kinetic LEADER reveal full-screen
 *  CC  "this coach"         ThigPro coach card slide-in
 */

loadCaveat();
loadEBGaramond();
loadInter("normal", { weights: ["900"] });

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────

const PAPER = "#F5EDD8";
const SEPIA = "#5C3A21";
const TERRACOTTA = "#C97B5C";
const FOREST = "#2C4A3E";
const SAGE = "#B5C5A5";

const FONT_HAND = '"Caveat", "Homemade Apple", cursive';
const FONT_SERIF = '"EB Garamond", "Crimson Text", Georgia, serif';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Word = { text?: string; word?: string; start: number; end: number };
type Transcript = { words?: Word[]; text?: string };
type ChunkBoundary = {
  index: number;
  start_sec: number;
  end_sec: number;
  dialogue_first_word: string | null;
  dialogue_last_word: string | null;
};
type ChunkBoundaries = { computed_at_utc: string; chunks: ChunkBoundary[] };

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

const normalize = (s: string) => s.toLowerCase().replace(/[^\w]/g, "");
const wordText = (w: Word) => (w.text ?? w.word ?? "") as string;

const findWord = (
  ws: Word[],
  search: string,
  occurrence = 1,
): Word | null => {
  const target = normalize(search);
  let n = 0;
  for (const w of ws) {
    if (normalize(wordText(w)) === target) {
      n += 1;
      if (n === occurrence) return w;
    }
  }
  return null;
};

const t = (sec: number, fps: number) => Math.round(sec * fps);

/** Gate weave — subtle film projector jitter applied to overlay layer.
 *  `phaseSeed` shifts the sine waves so two layers (paper vs text) drift
 *  independently and read as distinct physical pieces. */
const useGateWeave = (amp = 0.6, phaseSeed = 0, hzX = 2.3, hzY = 2.7, hzR = 1.9) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps + phaseSeed;
  return {
    x: amp * Math.sin(2 * Math.PI * hzX * time + phaseSeed * 1.7),
    y: amp * Math.sin(2 * Math.PI * hzY * time + 1.1 + phaseSeed * 2.3),
    rot: 0.05 * Math.sin(2 * Math.PI * hzR * time + 2.3 + phaseSeed * 1.1),
  };
};

/** Wiggle — slow hand-drawn boil for icons. ~1.8Hz, gentle. */
const useWiggle = (seed = 0, hz = 1.8) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps + seed * 0.43;
  return {
    rot: 1.2 * Math.sin(2 * Math.PI * hz * time),
    scale: 1 + 0.012 * Math.sin(2 * Math.PI * hz * time + 1.3),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// H — Hook overlay (journal page + TikTok pill)
// ─────────────────────────────────────────────────────────────────────────────

const HookOverlay: React.FC<{
  jobPublicPath: string;
  durationFrames: number;
}> = ({ jobPublicPath, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const weave = useGateWeave(0.6);

  // Fade out at end (last 6 frames)
  const exitFade = interpolate(
    frame,
    [durationFrames - 6, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Pill drops in at ~2s
  const pillEnter = spring({
    frame: frame - Math.round(2.0 * fps),
    fps,
    config: { damping: 18, stiffness: 180, mass: 0.8 },
  });

  return (
    <AbsoluteFill
      style={{
        opacity: exitFade,
        transform: `translate(${weave.x}px, ${weave.y}px) rotate(${weave.rot}deg)`,
      }}
    >
      <Img
        src={staticFile(`${jobPublicPath}/images/hook_journal_page.png`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center top",
        }}
      />
      {/* TikTok pill in bottom third */}
      <div
        style={{
          position: "absolute",
          left: "5%",
          right: "5%",
          bottom: "12%",
          transform: `scale(${0.85 + 0.15 * pillEnter}) translateY(${(1 - pillEnter) * 30}px)`,
          opacity: pillEnter,
        }}
      >
        <div
          style={{
            background: "#000000",
            borderRadius: 28,
            padding: "30px 36px",
            boxShadow: "0 16px 44px rgba(0,0,0,0.32), 0 4px 10px rgba(0,0,0,0.18)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
              fontWeight: 900,
              fontSize: 54,
              lineHeight: 1.1,
              color: "#FFFFFF",
              letterSpacing: -1.2,
              textTransform: "uppercase",
            }}
          >
            INSTANT PEACE BUT YOU'LL HAVE TO STOP DOING ONE THING
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// C1 / C2 — Lower-third credibility chip
// ─────────────────────────────────────────────────────────────────────────────

const CredChip: React.FC<{
  label1: string;
  label2: string;
  durationFrames: number;
}> = ({ label1, label2, durationFrames }) => {
  const frame = useCurrentFrame();
  // Authored on the 1920-tall portrait canvas; scaled to the job's canvas.
  const { fps, height } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 160 } });
  const exit = interpolate(
    frame,
    [durationFrames - 8, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(enter, exit);

  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top: Math.round(height * 220 / 1920),
        opacity,
        transform: `translateY(${(1 - enter) * -16}px)`,
      }}
    >
      <div
        style={{
          background: PAPER,
          border: `2px solid ${SEPIA}55`,
          borderRadius: 16,
          padding: "20px 28px",
          boxShadow: "0 6px 22px rgba(0,0,0,0.16)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontStyle: "italic",
            fontSize: 32,
            color: FOREST,
            opacity: 0.85,
            letterSpacing: 0.4,
          }}
        >
          {label1}
        </div>
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 600,
            fontSize: 36,
            color: FOREST,
            marginTop: 4,
          }}
        >
          {label2}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Notebook page base — crumpled paper + gate weave
// ─────────────────────────────────────────────────────────────────────────────

const NotebookPageBase: React.FC<{
  jobPublicPath: string;
  children: React.ReactNode;
  durationFrames: number;
}> = ({ jobPublicPath, children, durationFrames }) => {
  const frame = useCurrentFrame();
  // Paper and text get DIFFERENT gate weaves so they read as distinct physical
  // pieces — text drifts slightly differently from the page it sits on.
  const paperWeave = useGateWeave(0.7, 0, 2.3, 2.7, 1.9);
  const textWeave = useGateWeave(0.9, 1.43, 3.1, 2.1, 2.5);

  const enter = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const exit = interpolate(
    frame,
    [durationFrames - 8, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(enter, exit);

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Paper layer with its own gate weave */}
      <AbsoluteFill
        style={{
          transform: `translate(${paperWeave.x}px, ${paperWeave.y}px) rotate(${paperWeave.rot}deg)`,
        }}
      >
        <Img
          src={staticFile(`${jobPublicPath}/images/crumpled_paper_base.png`)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>
      {/* Text layer with INDEPENDENT gate weave so it reads as a separate piece */}
      <AbsoluteFill
        style={{
          transform: `translate(${textWeave.x}px, ${textWeave.y}px) rotate(${textWeave.rot}deg)`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// N1 — Notebook Page 1 (flowchart + doom-loop)
// ─────────────────────────────────────────────────────────────────────────────

/** Helper: a handwriting reveal that fades in word-by-word over a window. */
const HandwriteLine: React.FC<{
  text: string;
  fadeInStartFrame: number;
  fadeInDurationFrames?: number;
  style: React.CSSProperties;
}> = ({ text, fadeInStartFrame, fadeInDurationFrames = 10, style }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [fadeInStartFrame, fadeInStartFrame + fadeInDurationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const yOff = interpolate(
    frame,
    [fadeInStartFrame, fadeInStartFrame + fadeInDurationFrames],
    [12, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${yOff}px)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

/** A hand-drawn ink stroke (terracotta or sepia) that reveals over time. */
const InkStrike: React.FC<{
  startFrame: number;
  durationFrames?: number;
  style: React.CSSProperties;
  color?: string;
  thickness?: number;
}> = ({ startFrame, durationFrames = 10, style, color = TERRACOTTA, thickness = 6 }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [startFrame, startFrame + durationFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        ...style,
        background: color,
        borderRadius: thickness,
        height: thickness,
        transform: `scaleX(${progress})`,
        transformOrigin: "left center",
      }}
    />
  );
};

const NotebookPage1: React.FC<{
  jobPublicPath: string;
  durationFrames: number;
  fps: number;
  // Absolute seconds for each beat anchor — pre-resolved from transcript words
  chunk2Start: number;
  momentBeatSec: number;     // "feel" word — for "you feel off"
  labelBeatSec: number;      // "name" or "label" word — for "you LABEL it"
  inconsistentSec: number;
  enoughSec: number;
  overwhelmedSec: number;
  identityBeatSec: number;   // "identity" word — for IDENTITY reveal
}> = ({ jobPublicPath, durationFrames, fps, chunk2Start, momentBeatSec, labelBeatSec, inconsistentSec, enoughSec, overwhelmedSec, identityBeatSec }) => {
  // All frame indices below are relative to N1's Sequence start at chunk2Start.
  const f = (absSec: number) => Math.round((absSec - chunk2Start) * fps);

  return (
    <NotebookPageBase jobPublicPath={jobPublicPath} durationFrames={durationFrames}>
      {/* "Moment" upper-left — increased horizontal padding (left shifted right) */}
      <HandwriteLine
        text="A moment"
        fadeInStartFrame={f(chunk2Start + 0.2)}
        style={{
          position: "absolute",
          top: "10%",
          left: "16%",
          fontFamily: FONT_HAND,
          fontSize: 100,
          color: SEPIA,
          transform: "rotate(-2deg)",
        }}
      />

      {/* Arrow → "you feel off" — anchored to "feel" word */}
      <HandwriteLine
        text="↓"
        fadeInStartFrame={f(momentBeatSec - 0.2)}
        style={{
          position: "absolute",
          top: "20%",
          left: "22%",
          fontFamily: FONT_SERIF,
          fontSize: 90,
          color: SEPIA,
        }}
      />
      <HandwriteLine
        text="you feel off"
        fadeInStartFrame={f(momentBeatSec)}
        style={{
          position: "absolute",
          top: "26%",
          left: "18%",
          fontFamily: FONT_HAND,
          fontSize: 88,
          color: SEPIA,
          transform: "rotate(-1deg)",
        }}
      />

      {/* Arrow → "you LABEL it" — anchored to "name" / "label" word */}
      <HandwriteLine
        text="↓"
        fadeInStartFrame={f(labelBeatSec - 0.2)}
        style={{
          position: "absolute",
          top: "33%",
          left: "22%",
          fontFamily: FONT_SERIF,
          fontSize: 90,
          color: SEPIA,
        }}
      />
      <HandwriteLine
        text="you LABEL it"
        fadeInStartFrame={f(labelBeatSec)}
        style={{
          position: "absolute",
          top: "39%",
          left: "16%",
          fontFamily: FONT_HAND,
          fontSize: 92,
          color: TERRACOTTA,
          fontWeight: 700,
          transform: "rotate(-1.5deg)",
        }}
      />

      {/* Three quoted labels — anchored to actual spoken words */}
      <HandwriteLine
        text={`"I'm inconsistent."`}
        fadeInStartFrame={f(inconsistentSec)}
        style={{
          position: "absolute",
          top: "48%",
          left: "20%",
          right: "12%",
          fontFamily: FONT_HAND,
          fontSize: 70,
          color: SEPIA,
          transform: "rotate(-3deg)",
          textAlign: "center",
          textDecoration: "line-through",
          textDecorationColor: TERRACOTTA,
          textDecorationThickness: "3px",
        }}
      />
      <HandwriteLine
        text={`"I'm not enough."`}
        fadeInStartFrame={f(enoughSec)}
        style={{
          position: "absolute",
          top: "55%",
          left: "22%",
          right: "10%",
          fontFamily: FONT_HAND,
          fontSize: 70,
          color: SEPIA,
          transform: "rotate(2deg)",
          textAlign: "center",
          textDecoration: "line-through",
          textDecorationColor: TERRACOTTA,
          textDecorationThickness: "3px",
        }}
      />
      <HandwriteLine
        text={`"I'm overwhelmed."`}
        fadeInStartFrame={f(overwhelmedSec)}
        style={{
          position: "absolute",
          top: "62%",
          left: "21%",
          right: "11%",
          fontFamily: FONT_HAND,
          fontSize: 70,
          color: SEPIA,
          transform: "rotate(-2deg)",
          textAlign: "center",
          textDecoration: "line-through",
          textDecorationColor: TERRACOTTA,
          textDecorationThickness: "3px",
        }}
      />

      {/* Big arrow + IDENTITY at bottom — anchored to "identity" word, centered */}
      <HandwriteLine
        text="↓"
        fadeInStartFrame={f(identityBeatSec - 1.0)}
        style={{
          position: "absolute",
          top: "73%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: FONT_SERIF,
          fontSize: 110,
          color: TERRACOTTA,
        }}
      />
      <HandwriteLine
        text="IDENTITY"
        fadeInStartFrame={f(identityBeatSec)}
        fadeInDurationFrames={14}
        style={{
          position: "absolute",
          top: "82%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: FONT_SERIF,
          fontSize: 110,
          color: TERRACOTTA,
          fontWeight: 700,
          letterSpacing: 4,
          textDecoration: "underline",
          textDecorationThickness: "6px",
          textDecorationColor: TERRACOTTA,
        }}
      />
    </NotebookPageBase>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// N1b — Doom-loop stair-step (chunks 3A → 3B)
// ─────────────────────────────────────────────────────────────────────────────

const DoomLoop: React.FC<{
  jobPublicPath: string;
  durationFrames: number;
  fps: number;
  chunk3AStart: number;
  labelSec: number;
  rehearseSec: number;
  believeSec: number;
  becomeSec: number;
  repeatSec: number;
}> = ({ jobPublicPath, durationFrames, fps, chunk3AStart, labelSec, rehearseSec, believeSec, becomeSec, repeatSec }) => {
  const base = chunk3AStart;
  const f = (absSec: number) => Math.round((absSec - base) * fps);
  const frame = useCurrentFrame();

  // Word-anchored reveals — each word fades in slightly AFTER it's spoken so the
  // viewer connects the spoken word to the written one.
  const words = [
    { text: "LABEL", at: labelSec, color: SEPIA },
    { text: "REHEARSE", at: rehearseSec, color: SEPIA },
    { text: "BELIEVE", at: believeSec, color: SEPIA },
    { text: "BECOME", at: becomeSec, color: SEPIA },
    { text: "REPEAT", at: repeatSec, color: TERRACOTTA },
  ];

  // Circle around REPEAT — start drawing 0.3s after "repeat" lands
  const circleStart = f(repeatSec + 0.3);
  const circleProgress = interpolate(
    frame,
    [circleStart, circleStart + 14],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <NotebookPageBase jobPublicPath={jobPublicPath} durationFrames={durationFrames}>
      {words.map((w, i) => {
        const stepFrame = f(w.at);
        const opacity = interpolate(
          frame,
          [stepFrame, stepFrame + 10],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const yOff = interpolate(
          frame,
          [stepFrame, stepFrame + 10],
          [16, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const rot = (i % 2 === 0 ? -1.5 : 1.2);
        // Stair-step within safe padded zone (left 14% → right 14%)
        const indent = 14 + i * 5;
        return (
          <div
            key={w.text}
            style={{
              position: "absolute",
              top: `${14 + i * 14}%`,
              left: `${indent}%`,
              right: "10%",
              opacity,
              transform: `translateY(${yOff}px) rotate(${rot}deg)`,
              fontFamily: FONT_HAND,
              fontSize: w.text === "REPEAT" ? 138 : 116,
              color: w.color,
              fontWeight: w.text === "REPEAT" ? 700 : 500,
              letterSpacing: 4,
            }}
          >
            {w.text}
            {/* Arrow under each non-last word */}
            {i < words.length - 1 && (
              <div
                style={{
                  fontFamily: FONT_SERIF,
                  fontSize: 70,
                  color: SEPIA,
                  marginTop: -6,
                  marginLeft: 12,
                }}
              >
                ↓
              </div>
            )}
          </div>
        );
      })}

      {/* Hand-drawn circle around REPEAT */}
      <svg
        viewBox="0 0 600 200"
        style={{
          position: "absolute",
          top: "84%",
          left: `${14 + 4 * 5 - 6}%`,
          width: "55%",
          height: "auto",
          opacity: circleProgress > 0 ? 1 : 0,
        }}
      >
        <ellipse
          cx="300"
          cy="100"
          rx="260"
          ry="78"
          fill="none"
          stroke={TERRACOTTA}
          strokeWidth="8"
          strokeDasharray="1800"
          strokeDashoffset={1800 * (1 - circleProgress)}
          strokeLinecap="round"
          transform="rotate(-3 300 100)"
        />
      </svg>
    </NotebookPageBase>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// N2 — L.E.A.D.E.R acronym page (with wiggling icons)
// ─────────────────────────────────────────────────────────────────────────────

type LeaderRow = { letter: string; word: string; iconName: string };
const LEADER_ROWS: LeaderRow[] = [
  { letter: "L", word: "Locate", iconName: "icon_locate_compass" },
  { letter: "E", word: "Exhale", iconName: "icon_exhale_breath" },
  { letter: "A", word: "Accept", iconName: "icon_accept_palm" },
  { letter: "D", word: "Detach", iconName: "icon_detach_knot" },
  { letter: "E", word: "Edge", iconName: "icon_edge_footstep" },
  { letter: "R", word: "Repeat", iconName: "icon_repeat_arrow" },
];

const WigglingIcon: React.FC<{
  jobPublicPath: string;
  iconName: string;
  seed: number;
  size: number;
}> = ({ jobPublicPath, iconName, seed, size }) => {
  const wig = useWiggle(seed);
  return (
    <div
      style={{
        width: size,
        height: size,
        transform: `rotate(${wig.rot}deg) scale(${wig.scale})`,
      }}
    >
      {/* _alpha variant has white background chromakey'd to transparent (ffmpeg colorkey post-process) */}
      <Img
        src={staticFile(`${jobPublicPath}/images/${iconName}_alpha.png`)}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
};

const LeaderRowEl: React.FC<{
  row: LeaderRow;
  index: number;
  startFrame: number;
  jobPublicPath: string;
}> = ({ row, index, startFrame, jobPublicPath }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const xOff = interpolate(
    frame,
    [startFrame, startFrame + 10],
    [-30, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 28,
        height: "13%",
        opacity,
        transform: `translateX(${xOff}px)`,
      }}
    >
      {/* Big serif drop-cap letter */}
      <div
        style={{
          fontFamily: FONT_SERIF,
          fontWeight: 700,
          fontSize: 160,
          color: TERRACOTTA,
          width: 130,
          textAlign: "center",
          lineHeight: 1,
        }}
      >
        {row.letter}
      </div>
      {/* Handwritten word */}
      <div
        style={{
          fontFamily: FONT_HAND,
          fontSize: 108,
          color: SEPIA,
          flex: 1,
          transform: index % 2 === 0 ? "rotate(-0.8deg)" : "rotate(0.6deg)",
        }}
      >
        {row.word}
      </div>
      {/* Wiggling icon on the right */}
      <WigglingIcon
        jobPublicPath={jobPublicPath}
        iconName={row.iconName}
        seed={index}
        size={130}
      />
    </div>
  );
};

const NotebookPage2: React.FC<{
  jobPublicPath: string;
  durationFrames: number;
  fps: number;
  chunk5Start: number;
  // Each protocol verb's spoken-word start time
  locateSec: number;
  exhaleSec: number;
  acceptSec: number;
  detachSec: number;
  edgeSec: number;
  repeatSec: number;
}> = ({ jobPublicPath, durationFrames, fps, chunk5Start, locateSec, exhaleSec, acceptSec, detachSec, edgeSec, repeatSec }) => {
  const base = chunk5Start;
  const f = (absSec: number) => Math.round((absSec - base) * fps);

  // Each row reveals as the corresponding verb is spoken
  const startTimes = [locateSec, exhaleSec, acceptSec, detachSec, edgeSec, repeatSec];

  return (
    <NotebookPageBase jobPublicPath={jobPublicPath} durationFrames={durationFrames}>
      <div
        style={{
          position: "absolute",
          top: "8%",
          left: "8%",
          right: "8%",
          bottom: "8%",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* Header */}
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontStyle: "italic",
            fontSize: 64,
            color: FOREST,
            textAlign: "center",
            opacity: 0.85,
            marginBottom: 10,
          }}
        >
          The L.E.A.D.E.R Protocol
        </div>
        {LEADER_ROWS.map((row, i) => (
          <LeaderRowEl
            key={i}
            row={row}
            index={i}
            startFrame={f(startTimes[i])}
            jobPublicPath={jobPublicPath}
          />
        ))}
      </div>
    </NotebookPageBase>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// K — LEADER kinetic reveal
// ─────────────────────────────────────────────────────────────────────────────

const LeaderReveal: React.FC<{
  jobPublicPath: string;
  durationFrames: number;
}> = ({ jobPublicPath, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const weave = useGateWeave(0.8);

  const enter = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 200, mass: 0.6 },
  });
  const exit = interpolate(
    frame,
    [durationFrames - 8, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(enter, exit);
  const scale = 0.85 + 0.15 * enter;

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translate(${weave.x}px, ${weave.y}px) rotate(${weave.rot}deg)`,
      }}
    >
      <Img
        src={staticFile(`${jobPublicPath}/images/crumpled_paper_base.png`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 800,
            fontSize: 220,
            color: TERRACOTTA,
            letterSpacing: 2,
            transform: `scale(${scale})`,
            textShadow: `0 4px 0 ${SEPIA}22`,
            padding: "0 30px",
            whiteSpace: "nowrap",
          }}
        >
          LEADER
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CC — Coach card
// ─────────────────────────────────────────────────────────────────────────────

const CoachCard: React.FC<{ durationFrames: number }> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 160, mass: 0.9 },
  });
  const exit = interpolate(
    frame,
    [durationFrames - 8, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(enter, exit);
  const y = interpolate(enter, [0, 1], [300, 0]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "82%",
          background: PAPER,
          border: `4px solid ${TERRACOTTA}`,
          borderRadius: 28,
          padding: "56px 48px",
          textAlign: "center",
          boxShadow: "0 22px 60px rgba(0,0,0,0.28)",
          transform: `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 800,
            fontSize: 124,
            color: FOREST,
            letterSpacing: -2,
            lineHeight: 0.95,
          }}
        >
          ThigPro
        </div>
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontStyle: "italic",
            fontSize: 38,
            color: FOREST,
            opacity: 0.75,
            marginTop: 14,
          }}
        >
          Balance &amp; Relationship Advisory
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: 28,
            background: TERRACOTTA,
            color: PAPER,
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 44,
            padding: "14px 36px",
            borderRadius: 999,
            letterSpacing: 1,
          }}
        >
          thigpro.com
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export const JobOverlays: React.FC<JobOverlaysProps> = ({
  jobPublicPath,
  fps,
}) => {
  const transcript = useJobJson<Transcript>(
    `${jobPublicPath}/transcript.json`,
  );
  const boundaries = useJobJson<ChunkBoundaries>(
    `${jobPublicPath}/chunk_boundaries.json`,
  );

  if (!transcript || !boundaries) return null;

  const words = transcript.words ?? [];
  const chunks = boundaries.chunks;
  if (chunks.length < 8) {
    console.warn(`Expected 8 chunks, got ${chunks.length}`);
    return null;
  }

  // Map chunk indices (0-7 = chunks 1, 2, 3A, 3B, 4, 5, 6, 7)
  const c1 = chunks[0];
  const c2 = chunks[1];
  const c3A = chunks[2];
  const c3B = chunks[3];
  const c4 = chunks[4];
  const c5 = chunks[5];
  const c6 = chunks[6];
  const c7 = chunks[7];

  // Helper: find first word matching `target` whose start is inside [lo, hi]
  const findInRange = (target: string, lo: number, hi: number): Word | null => {
    const t0 = normalize(target);
    for (const w of words) {
      if (normalize(wordText(w)) === t0 && w.start >= lo && w.start <= hi) return w;
    }
    return null;
  };

  // Hook covers chunk 1 from 0 → word "5am" (or end of c1 if missing)
  const fiveAmWord = findWord(words, "5am") || findWord(words, "5") || findWord(words, "five");
  const hookEnd = fiveAmWord ? Math.min(fiveAmWord.end + 0.3, c1.end_sec) : Math.min(6.0, c1.end_sec);

  // ===== N1 word anchors (inside chunk 2) =====
  const feelWord = findInRange("feel", c2.start_sec, c2.end_sec);
  const nameWord = findInRange("name", c2.start_sec, c2.end_sec);
  const inconsistentWord = findInRange("inconsistent", c2.start_sec, c2.end_sec);
  const enoughWord = findInRange("enough", c2.start_sec, c2.end_sec);
  const overwhelmedWord = findInRange("overwhelmed", c2.start_sec, c2.end_sec);
  const identityWord = findInRange("identity", c2.start_sec, c2.end_sec);

  // ===== DoomLoop word anchors (chunks 3A + 3B) =====
  const labelWord = findInRange("label", c3A.start_sec, c3B.end_sec);
  const rehearseWord = findInRange("rehearse", c3A.start_sec, c3B.end_sec);
  const believeWord = findInRange("believe", c3A.start_sec, c3B.end_sec);
  const becomeWord = findInRange("become", c3A.start_sec, c3B.end_sec);
  // Last "repeat" in chunk 3B (there are multiple — the AHA "what you repeat... is what you become" has 2)
  let lastRepeat: Word | null = null;
  for (const w of words) {
    if (normalize(wordText(w)) === "repeat" && w.start >= c3A.start_sec && w.start <= c3B.end_sec) {
      lastRepeat = w;
    }
  }

  // ===== N2 L.E.A.D.E.R verb anchors (chunks 5 + 6) =====
  const locateWord = findInRange("locate", c5.start_sec, c6.end_sec);
  const exhaleWord = findInRange("exhale", c5.start_sec, c6.end_sec);
  const acceptWord = findInRange("accept", c5.start_sec, c6.end_sec);
  const detachWord = findInRange("detach", c5.start_sec, c6.end_sec);
  const edgeWord = findInRange("edge", c5.start_sec, c6.end_sec);
  // First "repeat" inside chunk 6 (the protocol step, not the later AHA echo)
  const repeatInC6 = findInRange("repeat", c6.start_sec, c6.end_sec);

  // "leader" word for kinetic reveal — last occurrence in chunk 6
  let leaderWord: Word | null = null;
  for (const w of words) {
    if (normalize(wordText(w)) === "leader" && w.start >= c6.start_sec && w.start <= c6.end_sec) {
      leaderWord = w;
    }
  }
  const leaderRevealStart = leaderWord ? leaderWord.start - 0.1 : c6.end_sec - 3.0;
  const leaderRevealEnd = leaderRevealStart + 1.2;

  // Coach card — slides in EARLIER on the brand-tagline word "intentionally"
  // (or "selfish" as fallback) so it has ~4s of screen time instead of ~1s.
  const intentionallyWord = findInRange("intentionally", c7.start_sec, c7.end_sec);
  const selfishWord = findInRange("selfish", c7.start_sec, c7.end_sec);
  const coachAnchor = intentionallyWord || selfishWord;
  const coachStart = coachAnchor ? coachAnchor.start - 0.1 : c7.start_sec + 1.5;
  const coachEnd = c7.end_sec;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* H — Hook overlay */}
      <Sequence
        from={0}
        durationInFrames={t(hookEnd, fps)}
      >
        <HookOverlay
          jobPublicPath={jobPublicPath}
          durationFrames={t(hookEnd, fps)}
        />
      </Sequence>

      {/* N1 — Notebook Page 1: flowchart (c2 → c3A start + ~1s overhang so IDENTITY can land) */}
      <Sequence
        from={t(c2.start_sec, fps)}
        durationInFrames={t(c3A.start_sec - c2.start_sec + 1.0, fps)}
      >
        <NotebookPage1
          jobPublicPath={jobPublicPath}
          durationFrames={t(c3A.start_sec - c2.start_sec + 1.0, fps)}
          fps={fps}
          chunk2Start={c2.start_sec}
          momentBeatSec={feelWord ? feelWord.start - 0.2 : c2.start_sec + 0.7}
          labelBeatSec={nameWord ? nameWord.start : c2.start_sec + 1.7}
          inconsistentSec={inconsistentWord ? inconsistentWord.start - 0.1 : c2.start_sec + 3.0}
          enoughSec={enoughWord ? enoughWord.start - 0.1 : c2.start_sec + 4.0}
          overwhelmedSec={overwhelmedWord ? overwhelmedWord.start - 0.1 : c2.start_sec + 5.0}
          identityBeatSec={identityWord ? identityWord.start - 0.1 : c2.end_sec - 0.8}
        />
      </Sequence>

      {/* N1b — Doom-loop (c3A → c3B end) */}
      <Sequence
        from={t(c3A.start_sec, fps)}
        durationInFrames={t(c3B.end_sec - c3A.start_sec, fps)}
      >
        <DoomLoop
          jobPublicPath={jobPublicPath}
          durationFrames={t(c3B.end_sec - c3A.start_sec, fps)}
          fps={fps}
          chunk3AStart={c3A.start_sec}
          /* LABEL pre-fires at DoomLoop's sequence start so the page isn't blank
             during the elaborated loop-widener ("And here's the part..."). The
             other doom-loop words still anchor to their spoken positions. */
          labelSec={c3A.start_sec + 0.5}
          rehearseSec={rehearseWord ? rehearseWord.start - 0.3 : c3A.start_sec + 2.5}
          believeSec={believeWord ? believeWord.start - 0.3 : c3B.start_sec + 1.5}
          becomeSec={becomeWord ? becomeWord.start - 0.3 : c3B.start_sec + 3.0}
          repeatSec={lastRepeat ? lastRepeat.start - 0.2 : c3B.start_sec + 4.5}
        />
      </Sequence>

      {/* N2 — Notebook Page 2: L.E.A.D.E.R (c5 → leader reveal start) */}
      <Sequence
        from={t(c5.start_sec, fps)}
        durationInFrames={t(leaderRevealStart - c5.start_sec, fps)}
      >
        <NotebookPage2
          jobPublicPath={jobPublicPath}
          durationFrames={t(leaderRevealStart - c5.start_sec, fps)}
          fps={fps}
          chunk5Start={c5.start_sec}
          locateSec={locateWord ? locateWord.start : c5.start_sec + 0.2}
          exhaleSec={exhaleWord ? exhaleWord.start : c5.start_sec + 2.5}
          acceptSec={acceptWord ? acceptWord.start : c5.start_sec + 5.0}
          detachSec={detachWord ? detachWord.start : c5.start_sec + 7.0}
          edgeSec={edgeWord ? edgeWord.start : c6.start_sec + 0.5}
          repeatSec={repeatInC6 ? repeatInC6.start : c6.start_sec + 2.0}
        />
      </Sequence>

      {/* K — LEADER kinetic reveal */}
      <Sequence
        from={t(leaderRevealStart, fps)}
        durationInFrames={t(leaderRevealEnd - leaderRevealStart, fps)}
      >
        <LeaderReveal
          jobPublicPath={jobPublicPath}
          durationFrames={t(leaderRevealEnd - leaderRevealStart, fps)}
        />
      </Sequence>

      {/* CC — Coach card */}
      <Sequence
        from={t(coachStart, fps)}
        durationInFrames={t(coachEnd - coachStart, fps)}
      >
        <CoachCard durationFrames={t(coachEnd - coachStart, fps)} />
      </Sequence>
    </AbsoluteFill>
  );
};

export default JobOverlays;
