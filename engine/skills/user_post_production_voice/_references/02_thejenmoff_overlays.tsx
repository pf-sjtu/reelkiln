/**
 * overlays.tsx — Jen Moff (job: thejenmoff.com-20260511-v5vkmu)
 *
 * High-production overlay stack:
 *   1. Kinetic word-by-word captions (whole video, replaces default captions)
 *   2. Pull-quote slam ("the more likely you are to LOSE", ~13.5–17.5s)
 *   3. Full-card stat takeover (Tasha Eurich 95% / 10–15%, ~20.5–26.5s)
 *      • paper-texture background with subtle gate-weave jitter
 *      • kinematic typography on the stat beats
 *   4. End-card brand reveal ("Jen Moff · Make your story worth telling", from
 *      ~40.5s through end + extend)
 *
 * Brand palette derived from vision.md + character_sheet wardrobe (oatmeal
 * linen + warm walnut + soft rust + cream). Render expects:
 *   uv run python agent/tools/remotion_render.py --job <id> --no-captions
 */

import {
  AbsoluteFill,
  Audio,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  spring,
  Easing,
} from "remotion";
import React, { useEffect, useState } from "react";
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
  if (occurrence < 0) {
    let want = -occurrence;
    for (let i = words.length - 1; i >= 0; i--) {
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

// ---------- Brand tokens ----------

const COLOR = {
  cream: "#F2EAD7",
  cream_soft: "rgba(242,234,215,0.96)",
  linen: "#E8DCC4",
  walnut: "#3B2A1E",
  walnut_soft: "rgba(59,42,30,0.86)",
  rust: "#B5512A",
  rust_soft: "rgba(181,81,42,0.92)",
  white: "#FFFFFF",
  black: "#0F0A06",
  ink: "#1A140E",
  shadow: "rgba(20,12,6,0.55)",
};

const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_SERIF = '"Georgia", "Times New Roman", serif';

// ---------- Kinetic word captions ----------

// Key words that get a brand-color highlight (rust accent).
const HIGHLIGHT_WORDS = new Set(
  [
    "rejected",
    "obviously",
    "simpler",
    "Jen",
    "Moff",
    "sometimes",
    "lose",
    "feel",
    "tasha",
    "eurich",
    "ninety-five",
    "self-aware",
    "fifteen",
    "inferior",
    "older",
    "tenured",
    "smartest",
    "read",
    "story",
    "telling",
  ].map(norm),
);

// Time windows where the kinetic captions should be HIDDEN (other overlays
// take over). Inclusive ranges in absolute video seconds.
const CAPTION_BLACKOUTS: [number, number][] = [
  [11.3, 17.4], // pull-quote — starts BEFORE "Sometimes" lands
  [20.5, 26.7], // stat card takeover
  [38.0, 999], // end card
];

const isBlackedOut = (tSec: number) => {
  for (const [a, b] of CAPTION_BLACKOUTS) if (tSec >= a && tSec <= b) return true;
  return false;
};

const KineticCaptions: React.FC<{
  words: TranscriptWord[];
  width: number;
  height: number;
}> = ({ words, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tNow = frame / fps;

  if (isBlackedOut(tNow)) return null;

  // Find the active word (word being spoken, with a small lead-in tail).
  // Also surface the next word as a faint "ghost" hint for kinematic flow.
  const LEAD_IN = 0.08; // seconds before word.start the caption appears
  const TAIL = 0.12; // seconds after word.end the caption lingers

  let active: TranscriptWord | null = null;
  for (const w of words) {
    if (tNow >= w.start - LEAD_IN && tNow <= w.end + TAIL) {
      active = w;
      break;
    }
  }
  if (!active) return null;

  const wordClean = active.word.replace(/[,.?!]$/, "");
  const isHighlight = HIGHLIGHT_WORDS.has(norm(active.word));

  // Subtle spring-pop on entry, linear fade on exit.
  const wEnter = (tNow - (active.start - LEAD_IN)) / Math.max(0.001, LEAD_IN + 0.05);
  const enterT = Math.min(1, Math.max(0, wEnter));
  const scaleIn = interpolate(enterT, [0, 1], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const wExit = (active.end + TAIL - tNow) / Math.max(0.001, TAIL);
  const exitT = Math.min(1, Math.max(0, wExit));
  const opacity = interpolate(exitT, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Smaller base + larger italic highlight, no caps, no box, drop shadow only.
  const baseSize = Math.round(height * 0.042);
  const fontSize = isHighlight ? Math.round(baseSize * 1.28) : baseSize;
  const dropShadow =
    "0 3px 10px rgba(0,0,0,0.72), 0 1px 3px rgba(0,0,0,0.55)";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: Math.round(height * 0.80),
          display: "flex",
          justifyContent: "center",
          opacity,
        }}
      >
        <span
          style={{
            fontFamily: FONT,
            fontWeight: 900,
            fontStyle: isHighlight ? "italic" : "normal",
            fontSize,
            color: COLOR.white,
            letterSpacing: "-0.028em",
            transform: `scale(${scaleIn})`,
            textShadow: dropShadow,
            display: "inline-block",
            lineHeight: 1.0,
          }}
        >
          {wordClean}
        </span>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Pull-quote slam (paradox punchline) ----------

const PullQuote: React.FC<{
  jobPublicPath: string;
  width: number;
  height: number;
  durationFrames: number;
  quoteWords: TranscriptWord[]; // words from "Sometimes" through "lose"
  sequenceStartSec: number; // absolute time the parent Sequence enters
}> = ({ jobPublicPath, width, height, durationFrames, quoteWords, sequenceStartSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tNow = sequenceStartSec + frame / fps;

  // Card-level fade in / fade out
  const buildIn = interpolate(frame, [0, Math.round(fps * 0.35)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exitStart = durationFrames - Math.round(fps * 0.5);
  const exitFade = interpolate(frame, [exitStart, durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const baseOpacity = Math.min(buildIn, exitFade);

  // Word-by-word reveal. Each word springs in at its own start time.
  const renderWord = (w: TranscriptWord, idx: number) => {
    const wordClean = w.word.replace(/[,.?!]$/, "");
    const isLose = norm(w.word) === "lose";
    const wordFrameLocal = (w.start - sequenceStartSec) * fps;
    const wordSpring = spring({
      frame: frame - wordFrameLocal,
      fps,
      config: { damping: 14, stiffness: 200, mass: 0.5 },
    });
    const wordOpacity = interpolate(wordSpring, [0, 1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const wordScale = interpolate(wordSpring, [0, 1], [0.86, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    // LOSE gets an extra slam: bigger, rust accent, no italic.
    if (isLose) {
      return (
        <span
          key={idx}
          style={{
            display: "inline-block",
            opacity: wordOpacity,
            transform: `scale(${wordScale * 1.18})`,
            transformOrigin: "left center",
            color: COLOR.rust,
            fontStyle: "normal",
            fontWeight: 900,
            fontSize: "1.3em",
            textShadow:
              "0 6px 22px rgba(181,81,42,0.45), 2px 2px 0 rgba(15,10,6,0.85), -2px -2px 0 rgba(15,10,6,0.85)",
          }}
        >
          {wordClean}.
        </span>
      );
    }
    return (
      <span
        key={idx}
        style={{
          display: "inline-block",
          opacity: wordOpacity,
          transform: `scale(${wordScale})`,
          transformOrigin: "left center",
        }}
      >
        {wordClean}
        {w.word.endsWith(",") ? "," : ""}
      </span>
    );
  };

  // Gate-weave jitter (analog film projector feel) — same recipe as stat card
  const t = frame / fps;
  const jitterX = Math.sin(t * 11.3) * 1.8 + Math.sin(t * 27.7) * 1.0;
  const jitterY = Math.sin(t * 9.1 + 1.7) * 1.6 + Math.sin(t * 31.2 + 2.3) * 0.8;
  const flickerOpacity = 1 - Math.abs(Math.sin(t * 38.0)) * 0.04;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: baseOpacity * flickerOpacity,
        transform: `translate(${jitterX}px, ${jitterY}px)`,
      }}
    >
      {/* Paper texture backdrop, full-bleed */}
      <Img
        src={staticFile(`${jobPublicPath}/images/stat_card_bg.png`)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      {/* Vignette tint to lock the warm tone */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(255,239,210,0.0) 0%, rgba(120,80,40,0.18) 70%, rgba(60,35,15,0.42) 100%)",
        }}
      />

      {/* Eyebrow attribution at top */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: Math.round(height * 0.08),
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: Math.round(height * 0.020),
            color: COLOR.rust,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
          }}
        >
          — Jen Moff
        </span>
      </div>

      {/* Quote text centered on the card */}
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.18),
          left: Math.round(width * 0.07),
          right: Math.round(width * 0.07),
          bottom: Math.round(height * 0.18),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT_SERIF,
          fontWeight: 900,
          fontStyle: "italic",
          color: COLOR.ink,
          fontSize: Math.round(height * 0.066),
          letterSpacing: "-0.025em",
          lineHeight: 1.12,
          textAlign: "left",
        }}
      >
        <div>
          <span style={{ color: COLOR.walnut_soft, marginRight: "0.18em", fontSize: "1.1em" }}>“</span>
          {quoteWords.map((w, i) => (
            <React.Fragment key={i}>
              {renderWord(w, i)}
              {" "}
            </React.Fragment>
          ))}
          <span style={{ color: COLOR.walnut_soft, marginLeft: "0.05em", fontSize: "1.1em" }}>”</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Stat card takeover (Eurich research) ----------

const StatCard: React.FC<{
  jobPublicPath: string;
  width: number;
  height: number;
  durationFrames: number;
  sequenceStartSec: number;
  // Absolute timestamps of the beats
  tashaSec: number;
  ninetyFiveSec: number;
  butOnlySec: number;
  fifteenSec: number;
  actuallySec: number;
}> = ({
  jobPublicPath,
  width,
  height,
  durationFrames,
  sequenceStartSec,
  tashaSec,
  ninetyFiveSec,
  butOnlySec,
  fifteenSec,
  actuallySec,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tNow = sequenceStartSec + frame / fps;

  // Overall card fade in/out
  const cardIn = interpolate(frame, [0, Math.round(fps * 0.35)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exitStart = durationFrames - Math.round(fps * 0.45);
  const cardOut = interpolate(frame, [exitStart, durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cardAlpha = Math.min(cardIn, cardOut);

  // Gate-weave jitter (analog film projector feel)
  // Two layered sine waves at different frequencies = organic micro-shake.
  const t = frame / fps;
  const jitterX = Math.sin(t * 11.3) * 1.6 + Math.sin(t * 27.7) * 0.9;
  const jitterY = Math.sin(t * 9.1 + 1.7) * 1.4 + Math.sin(t * 31.2 + 2.3) * 0.7;
  // Subtle opacity flicker at film-projector frequency
  const flickerOpacity = 1 - Math.abs(Math.sin(t * 38.0)) * 0.04;

  // "DID YOU KNOW?" eyebrow appears at the very start of the card
  const eyebrowIn = interpolate(frame, [Math.round(fps * 0.1), Math.round(fps * 0.4)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // 95% spring on "ninety-five"
  const ninetyFiveFrame = (ninetyFiveSec - sequenceStartSec) * fps;
  const ninetyFiveSpring = spring({
    frame: frame - ninetyFiveFrame,
    fps,
    config: { damping: 10, stiffness: 220, mass: 0.7 },
  });
  const ninetyFiveScale = interpolate(ninetyFiveSpring, [0, 1], [0.45, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ninetyFiveOpacity = interpolate(frame - ninetyFiveFrame, [-3, 0], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subline under 95% appears on "self-aware"
  const subAOpacity = interpolate(tNow, [ninetyFiveSec + 0.55, ninetyFiveSec + 0.95], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "but only" connector — appears just before "ten/fifteen"
  const butOnlyOpacity = interpolate(tNow, [butOnlySec - 0.05, butOnlySec + 0.25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 10-15% spring on "fifteen"
  const fifteenFrame = (fifteenSec - sequenceStartSec) * fps;
  const fifteenSpring = spring({
    frame: frame - fifteenFrame,
    fps,
    config: { damping: 9, stiffness: 240, mass: 0.6 },
  });
  const fifteenScale = interpolate(fifteenSpring, [0, 1], [0.55, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fifteenOpacity = interpolate(frame - fifteenFrame, [-3, 0], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "ACTUALLY ARE" subline appears on "actually"
  const subBOpacity = interpolate(tNow, [actuallySec - 0.05, actuallySec + 0.25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Once the 10-15% lands, the 95% softens (gets out of the way)
  const ninetyFiveFinal =
    tNow > fifteenSec
      ? interpolate(tNow, [fifteenSec, fifteenSec + 0.4], [1, 0.55], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  // Citation strip at the bottom — appears with the "but only" beat
  const citationOpacity = interpolate(
    tNow,
    [butOnlySec + 0.3, butOnlySec + 0.9],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        opacity: cardAlpha * flickerOpacity,
        transform: `translate(${jitterX}px, ${jitterY}px)`,
      }}
    >
      {/* Paper texture backdrop, full-bleed */}
      <Img
        src={staticFile(`${jobPublicPath}/images/stat_card_bg.png`)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      {/* Vignette tint to lock the warm tone */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(255,239,210,0.0) 0%, rgba(120,80,40,0.18) 70%, rgba(60,35,15,0.42) 100%)",
        }}
      />
      {/* Eyebrow — DID YOU KNOW? */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: Math.round(height * 0.12),
          textAlign: "center",
          opacity: eyebrowIn,
        }}
      >
        <span
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: Math.round(height * 0.024),
            color: COLOR.rust,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
          }}
        >
          Did you know?
        </span>
      </div>

      {/* 95% — massive spring-in */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: Math.round(height * 0.20),
          textAlign: "center",
          opacity: ninetyFiveOpacity * ninetyFiveFinal,
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 900,
            fontSize: Math.round(height * 0.20),
            color: COLOR.ink,
            lineHeight: 1.0,
            transform: `scale(${ninetyFiveScale * (tNow > fifteenSec ? 0.78 : 1)})`,
            transformOrigin: "center",
            letterSpacing: "-0.04em",
            textShadow: "0 3px 0 rgba(140,90,40,0.18)",
          }}
        >
          95%
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: Math.round(height * 0.022),
            color: COLOR.walnut,
            marginTop: Math.round(height * 0.005),
            opacity: subAOpacity * (tNow > fifteenSec ? 0.7 : 1),
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          think they're self-aware
        </div>
      </div>

      {/* "but only" connector */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: Math.round(height * 0.50),
          textAlign: "center",
          opacity: butOnlyOpacity,
        }}
      >
        <span
          style={{
            fontFamily: FONT_SERIF,
            fontStyle: "italic",
            fontSize: Math.round(height * 0.034),
            color: COLOR.walnut_soft,
            letterSpacing: "0.02em",
          }}
        >
          but only…
        </span>
      </div>

      {/* 10-15% — second spring with rust accent */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: Math.round(height * 0.55),
          textAlign: "center",
          opacity: fifteenOpacity,
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 900,
            fontSize: Math.round(height * 0.13),
            color: COLOR.rust,
            lineHeight: 1.0,
            transform: `scale(${fifteenScale})`,
            transformOrigin: "center",
            letterSpacing: "-0.04em",
            textShadow: "0 3px 0 rgba(140,50,18,0.22)",
            whiteSpace: "nowrap",
            padding: "0 8%",
          }}
        >
          10–15%
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: Math.round(height * 0.022),
            color: COLOR.rust_soft,
            marginTop: Math.round(height * 0.012),
            opacity: subBOpacity,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          actually are
        </div>
      </div>

      {/* Citation strip */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: Math.round(height * 0.025),
          textAlign: "center",
          opacity: citationOpacity,
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: `${Math.round(height * 0.008)}px ${Math.round(height * 0.022)}px`,
            background: "rgba(20,12,6,0.78)",
            borderRadius: 4,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: Math.round(height * 0.016),
              color: COLOR.cream,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
            }}
          >
            Tasha Eurich · HBR 2018 · Insight
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- End card brand reveal ----------

const EndCard: React.FC<{
  width: number;
  height: number;
  durationFrames: number;
}> = ({ width, height, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, Math.round(fps * 0.5)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const slideUp = interpolate(frame, [0, Math.round(fps * 0.5)], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        opacity: fadeIn,
        background:
          "linear-gradient(180deg, rgba(15,10,6,0.85) 0%, rgba(15,10,6,0.95) 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          transform: `translateY(calc(-50% + ${slideUp}px))`,
          textAlign: "center",
          padding: `0 ${Math.round(width * 0.06)}px`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 900,
            fontSize: Math.round(height * 0.11),
            color: COLOR.cream,
            letterSpacing: "-0.02em",
            lineHeight: 1.0,
            textShadow: "0 4px 18px rgba(0,0,0,0.55)",
          }}
        >
          JEN MOFF
        </div>
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontStyle: "italic",
            fontSize: Math.round(height * 0.032),
            color: COLOR.linen,
            marginTop: Math.round(height * 0.025),
            letterSpacing: "0.01em",
          }}
        >
          Make your story worth telling.
        </div>
        <div
          style={{
            marginTop: Math.round(height * 0.055),
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: Math.round(height * 0.012),
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: Math.round(height * 0.024),
              color: COLOR.rust,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            thejenmoff.com
          </span>
          <span
            style={{
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: Math.round(height * 0.024),
              color: COLOR.rust,
            }}
          >
            →
          </span>
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

  // Anchor words. All resolved with explicit occurrence indices.
  const wSometimes = findWord(transcript.words, "Sometimes", 1);
  const wLose = findWord(transcript.words, "lose", 1);
  const wTasha = findWord(transcript.words, "Tasha", 1);
  const wNinetyFive = findWord(transcript.words, "ninety-five", 1);
  const wSelfAware = findWord(transcript.words, "self-aware", 1);
  const wOnly = findWord(transcript.words, "only", 1);
  const wFifteen = findWord(transcript.words, "fifteen", 1);
  const wActually = findWord(transcript.words, "actually", 1);
  const wWanna = findWord(transcript.words, "wanna", 1);

  // ---- Pull-quote sequence ----
  // From ~250ms before "Sometimes" through ~700ms after "lose".
  // Match the SAM clip window (11.3-17.4 → 6.1s) used by ffmpeg compose.
  const pullStart = 11.3;
  const pullEnd = 17.4;
  const pullStartFrame = Math.round(pullStart * fps);
  const pullDurationFrames = Math.round((pullEnd - pullStart) * fps);

  // Slice transcript words from "Sometimes" through "lose" for word-by-word reveal.
  const quoteWords: TranscriptWord[] =
    wSometimes && wLose
      ? transcript.words.filter(
          (w) => w.start >= wSometimes.start && w.start <= wLose.start,
        )
      : [];

  // ---- Stat card sequence ----
  // From just before "Tasha" through ~600ms after "actually".
  const statStart = wTasha ? wTasha.start - 0.45 : 20.9;
  const statEnd = wActually ? wActually.end + 0.65 : 26.6;
  const statStartFrame = Math.round(statStart * fps);
  const statDurationFrames = Math.round((statEnd - statStart) * fps);

  // ---- End card ----
  // Starts on "wanna" (the CTA setup beat) and holds through end + render-extra.
  const endStart = wWanna ? wWanna.start - 0.15 : 38.1;
  const endStartFrame = Math.round(endStart * fps);
  const totalFrames = Math.round(durationSeconds * fps);
  const endDurationFrames = totalFrames - endStartFrame;

  return (
    <AbsoluteFill>
      {/* Kinetic captions run on the avatar timeline, suppress themselves
          during pull-quote / stat card / end card via CAPTION_BLACKOUTS */}
      <KineticCaptions words={transcript.words} width={width} height={height} />

      {/* Pull-quote with person foreground compositing */}
      {wLose && wSometimes && quoteWords.length > 0 && (
        <Sequence from={pullStartFrame} durationInFrames={pullDurationFrames}>
          <PullQuote
            jobPublicPath={jobPublicPath}
            width={width}
            height={height}
            durationFrames={pullDurationFrames}
            quoteWords={quoteWords}
            sequenceStartSec={pullStart}
          />
        </Sequence>
      )}

      {/* Stat card takeover */}
      {wTasha && wNinetyFive && wOnly && wFifteen && wActually && (
        <Sequence from={statStartFrame} durationInFrames={statDurationFrames}>
          <StatCard
            jobPublicPath={jobPublicPath}
            width={width}
            height={height}
            durationFrames={statDurationFrames}
            sequenceStartSec={statStart}
            tashaSec={wTasha.start}
            ninetyFiveSec={wNinetyFive.start}
            butOnlySec={wOnly.start}
            fifteenSec={wFifteen.start}
            actuallySec={wActually.start}
          />
        </Sequence>
      )}

      {/* End card brand reveal */}
      {wWanna && endDurationFrames > 0 && (
        <Sequence from={endStartFrame} durationInFrames={endDurationFrames}>
          <EndCard width={width} height={height} durationFrames={endDurationFrames} />
        </Sequence>
      )}

      {/* ===== SFX layer ===== */}

      {/* Whoosh on pull-quote card entrance */}
      {wSometimes && wLose && (
        <Sequence from={pullStartFrame} durationInFrames={Math.round(fps * 2.1)}>
          <Audio src={staticFile(`${jobPublicPath}/sfx/whoosh.mp3`)} volume={0.55} />
        </Sequence>
      )}

      {/* Keyboard typing under the quote — starts on "Sometimes" word */}
      {wSometimes && wLose && (
        <Sequence
          from={Math.round(wSometimes.start * fps)}
          durationInFrames={Math.round((wLose.start - wSometimes.start + 0.3) * fps)}
        >
          <Audio src={staticFile(`${jobPublicPath}/sfx/keyboard_typing.mp3`)} volume={0.30} />
        </Sequence>
      )}

      {/* Sub-bass THUD on LOSE slam */}
      {wLose && (
        <Sequence
          from={Math.round(wLose.start * fps)}
          durationInFrames={Math.round(fps * 0.9)}
        >
          <Audio src={staticFile(`${jobPublicPath}/sfx/thud.mp3`)} volume={0.7} />
        </Sequence>
      )}

      {/* Whoosh on stat-card entrance */}
      {wTasha && wActually && (
        <Sequence from={statStartFrame} durationInFrames={Math.round(fps * 2.1)}>
          <Audio src={staticFile(`${jobPublicPath}/sfx/whoosh.mp3`)} volume={0.55} />
        </Sequence>
      )}

      {/* Film projector ambient looped under stat card (2.28s clip × ~3 loops to cover ~6.2s) */}
      {wTasha && wActually && (
        <Sequence from={statStartFrame} durationInFrames={statDurationFrames}>
          <Loop durationInFrames={Math.round(fps * 2.28)}>
            <Audio src={staticFile(`${jobPublicPath}/sfx/film_camera_roll.mp3`)} volume={0.18} />
          </Loop>
        </Sequence>
      )}

      {/* Mechanical click on 95% drop */}
      {wNinetyFive && (
        <Sequence
          from={Math.round(wNinetyFive.start * fps)}
          durationInFrames={Math.round(fps * 1.05)}
        >
          <Audio src={staticFile(`${jobPublicPath}/sfx/click.mp3`)} volume={0.5} />
        </Sequence>
      )}

      {/* Mechanical click on 10-15% drop */}
      {wFifteen && (
        <Sequence
          from={Math.round(wFifteen.start * fps)}
          durationInFrames={Math.round(fps * 1.05)}
        >
          <Audio src={staticFile(`${jobPublicPath}/sfx/click.mp3`)} volume={0.5} />
        </Sequence>
      )}

      {/* Whoosh on end-card entrance */}
      {wWanna && (
        <Sequence from={endStartFrame} durationInFrames={Math.round(fps * 2.1)}>
          <Audio src={staticFile(`${jobPublicPath}/sfx/whoosh.mp3`)} volume={0.55} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

export default JobOverlays;
