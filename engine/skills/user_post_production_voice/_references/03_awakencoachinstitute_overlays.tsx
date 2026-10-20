/**
 * Awaken Coach Institute — per-job overlays.
 *
 * Round 3 (post-production iteration):
 *   1. Watch-till-end sticker (upper third, fade in at 1s → out at brand pivot)
 *   2. Awaken URL pill at the close (last 1.5s, brand-pink pill)
 *
 * Removed in round 3 per user feedback:
 *   - Word-pop pink emphasis (replaced by caption-italic via style_directives.json)
 *   - MCC credibility card (covered captions)
 *
 * Italic emphasis is now handled by the caption track itself (Captioned.tsx +
 * CaptionPage.tsx reading italic_word_starts_ms from style_directives.json).
 * Active-word color highlight disabled by setting active_word_color = inactive
 * white in style_directives.json (no more cyan flashing).
 */

import {
  AbsoluteFill,
  Video,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  delayRender,
  continueRender,
  cancelRender,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { useEffect, useState } from "react";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import type { JobOverlaysProps } from "./_jobOverlaysContract";

loadInter("normal", { weights: ["500", "600", "700", "800"], subsets: ["latin"] });

// Awaken brand pink — for the closing URL pill.
const AWAKEN_PINK = "#F472B6";

type Word = { word: string; start: number; end: number };
type Transcript = { words: Word[]; text: string; language: string };

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
      .catch(cancelRender);
  }, []);
  return data;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, "");

const findWord = (ws: Word[], search: string, occurrence = 1): Word | null => {
  let n = 0;
  const needle = norm(search);
  for (const w of ws) {
    if (norm(w.word) === needle) {
      n += 1;
      if (n === occurrence) return w;
    }
  }
  return null;
};

// ────────────────────────────────────────────────────────────────────────────
// 1. Watch-till-end sticker
// ────────────────────────────────────────────────────────────────────────────

const WatchTillEndSticker: React.FC<{
  fps: number;
  enterFrame: number;
  exitFrame: number;
}> = ({ fps, enterFrame, exitFrame }) => {
  const frame = useCurrentFrame();
  // Authored on the 1920-tall portrait canvas; scaled to the job's canvas.
  const { height } = useVideoConfig();
  // No fade-in — opaque from frame 0. Only a soft fade-out near exit.
  const exit = interpolate(frame, [exitFrame - 10, exitFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const opacity = exit;
  const drift = Math.sin((frame / fps) * 0.8) * 1.5;

  if (frame < enterFrame || frame > exitFrame) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: Math.round(height * 280 / 1920),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        opacity,
        transform: `translateY(${drift}px)`,
      }}
    >
      <div
        style={{
          background: "rgba(0, 0, 0, 0.92)",
          color: "#FFFFFF",
          fontFamily: "Inter",
          fontWeight: 600,
          fontSize: 44,
          letterSpacing: 0.2,
          padding: "16px 28px",
          borderRadius: 999,
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
          backdropFilter: "blur(6px)",
        }}
      >
        feeling lost in your career? watch till the end
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 2. Awaken URL pill — last 1.5s, brand-pink pill above the caption band
// ────────────────────────────────────────────────────────────────────────────

const UrlPill: React.FC<{
  fps: number;
  enterFrame: number;
  exitFrame: number;
}> = ({ fps, enterFrame, exitFrame }) => {
  const frame = useCurrentFrame();
  // Authored on the 1920-tall portrait canvas; scaled to the job's canvas.
  const { height } = useVideoConfig();
  const enter = spring({
    frame: frame - enterFrame,
    fps,
    config: { damping: 14, stiffness: 200 },
  });
  const fade = interpolate(frame, [exitFrame - 6, exitFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(enter, fade);

  if (frame < enterFrame || frame > exitFrame) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: Math.round(height * 1450 / 1920),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        opacity,
        transform: `scale(${enter})`,
      }}
    >
      <div
        style={{
          background: AWAKEN_PINK,
          color: "#1A0B14",
          fontFamily: "Inter",
          fontWeight: 800,
          fontSize: 42,
          letterSpacing: 0.8,
          padding: "16px 32px",
          borderRadius: 999,
          boxShadow: "0 6px 22px rgba(244, 114, 182, 0.45)",
        }}
      >
        awakencoachinstitute.com
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 3. Journal-writing B-roll insert — full-screen, crossfade in/out, audio muted
//    (avatar audio continues underneath per gen_broll.py contract).
// ────────────────────────────────────────────────────────────────────────────

const JournalBroll: React.FC<{
  fps: number;
  enterFrame: number;
  exitFrame: number;
  videoSrc: string;
}> = ({ fps, enterFrame, exitFrame, videoSrc }) => {
  const frame = useCurrentFrame();
  const fadeFrames = Math.round(0.15 * fps); // 150ms crossfade in/out
  const fadeIn = interpolate(frame, [enterFrame, enterFrame + fadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fadeOut = interpolate(frame, [exitFrame - fadeFrames, exitFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const opacity = Math.min(fadeIn, fadeOut);

  if (frame < enterFrame || frame > exitFrame) return null;

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <Video
        src={videoSrc}
        muted
        startFrom={0}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// JobOverlays — composition root
// ────────────────────────────────────────────────────────────────────────────

export const JobOverlays: React.FC<JobOverlaysProps> = ({ jobPublicPath, fps, durationSeconds }) => {
  const transcript = useJobJson<Transcript>(`${jobPublicPath}/transcript.json`);
  if (!transcript) return null;
  const words = transcript.words;

  // Sticker is opaque from frame 0, fades out by 5s.
  const stickerEnter = 0;
  const stickerExit = 5.0;

  // URL pill enters in the last 1.5s
  const lastWord = words[words.length - 1];
  const urlEnter = lastWord.end - 1.5;
  const urlExit = lastWord.end + 0.2;

  // Journal-writing b-roll: fires on "pulled from my corporate role" (19.0–21.5s)
  const brollEnter = 19.0;
  const brollExit = 21.5;
  const brollVideoSrc = staticFile(`${jobPublicPath}/broll/journal_writing.mp4`);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Order matters — JournalBroll renders FIRST so the sticker stays on top */}
      <JournalBroll
        fps={fps}
        enterFrame={Math.round(brollEnter * fps)}
        exitFrame={Math.round(brollExit * fps)}
        videoSrc={brollVideoSrc}
      />
      <WatchTillEndSticker
        fps={fps}
        enterFrame={Math.round(stickerEnter * fps)}
        exitFrame={Math.round(stickerExit * fps)}
      />
      <UrlPill
        fps={fps}
        enterFrame={Math.round(urlEnter * fps)}
        exitFrame={Math.round(urlExit * fps)}
      />
    </AbsoluteFill>
  );
};

export default JobOverlays;
