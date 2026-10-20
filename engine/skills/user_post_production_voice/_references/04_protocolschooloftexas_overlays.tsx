import React from "react";
import {
  AbsoluteFill,
  Img,
  Video,
  Sequence,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import type { JobOverlaysProps } from "../../../agent/remotion/src/_jobOverlaysContract";

/**
 * Protocol School of Texas — custom overlays.
 *
 * Beats:
 *  - 1.96-3.0s   ETIQUETTE ILLITERATE custom big-text reveal (replaces default captions for those words)
 *  - 20.0-39.6s  30-second etiquette audit header + countdown timer ticking down
 *  - 23.7-35.5s  5 audit-question icons appearing with wiggle, each ~1.5-2s
 *  - 37.9-39.6s  HUGE UNLOCK stamp + countdown flashes green and stops
 *  - 46.2-48.7s  Skills→Etiquette stat card slides in from right
 *  - 52.1-55.0s  Diane Gottsman introduction-card slides in from left lower-third
 *  - 55.0-57.4s  Callback hold-frame: italic serif quote at top
 *
 * SFX layered:
 *  - 1.0s   phone-tap (sets phone down off-frame)
 *  - 1.96s  stamp-slam (ETIQUETTE ILLITERATE lands)
 *  - 5 click-pops at icon entries
 *  - 1 whoosh on stat-card entry
 *  - 1 whoosh on Diane-card entry
 */

const FONT_TITLE =
  '"Inter", "Helvetica Neue", -apple-system, BlinkMacSystemFont, sans-serif';
const FONT_SERIF = '"Cormorant Garamond", "Times New Roman", serif';

// Color palette aligned with Diane's brand
const COLOR_NAVY = "#172447";
const COLOR_CREAM = "#F5EFE3";
const COLOR_RUST = "#C2552C";
const COLOR_RED = "#C92F2A";
const COLOR_GREEN = "#2E7D32";

const fps = 30;
const t = (sec: number) => Math.round(sec * fps); // helper

export const JobOverlays: React.FC<JobOverlaysProps> = ({ jobPublicPath }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* ===== 0-0.42s — Phone red-flash mask (etiquette violation visual) ===== */}
      <Sequence from={0} durationInFrames={t(0.42)}>
        <PhoneRedFlash
          src={staticFile(`${jobPublicPath}/phone_red_flash.mp4`)}
        />
        <Audio
          src={staticFile(`${jobPublicPath}/sfx/warning_pulse.mp3`)}
          volume={0.55}
        />
      </Sequence>

      {/* ===== SFX ===== */}
      <Sequence from={t(0.95)} durationInFrames={t(0.5)}>
        <Audio
          src={staticFile(`${jobPublicPath}/sfx/phone_tap_wood.mp3`)}
          volume={0.7}
        />
      </Sequence>

      <Sequence from={t(1.96)} durationInFrames={t(1.0)}>
        <Audio src={staticFile("sfx/impacts/stamp_slam.mp3")} volume={0.55} />
      </Sequence>

      {/* ===== 1.96-3.0s — ETIQUETTE ILLITERATE big-text reveal ===== */}
      <Sequence from={t(1.96)} durationInFrames={t(1.6)}>
        <EtiquetteIlliterateReveal width={width} height={height} />
      </Sequence>

      {/* ===== 13.5-20.0s — Full-screen 85% stat card with logos + gate weave ===== */}
      <Sequence from={t(13.5)} durationInFrames={t(6.5)}>
        <StatCard85
          jobPublicPath={jobPublicPath}
          width={width}
          height={height}
        />
      </Sequence>
      {/* Click SFX for each logo entry */}
      <Sequence from={t(13.72)} durationInFrames={t(0.3)}>
        <Audio src={staticFile("sfx/ui/click_tight.mp3")} volume={0.65} />
      </Sequence>
      <Sequence from={t(14.18)} durationInFrames={t(0.3)}>
        <Audio src={staticFile("sfx/ui/click_tight.mp3")} volume={0.65} />
      </Sequence>
      <Sequence from={t(14.88)} durationInFrames={t(0.3)}>
        <Audio src={staticFile("sfx/ui/click_tight.mp3")} volume={0.65} />
      </Sequence>
      <Sequence from={t(16.66)} durationInFrames={t(0.3)}>
        <Audio src={staticFile("sfx/impacts/thud_chest.mp3")} volume={0.55} />
      </Sequence>

      {/* ===== 20.0-39.6s — 30-second audit header + countdown ===== */}
      <Sequence from={t(20.0)} durationInFrames={t(19.6)}>
        <AuditHeaderAndTimer width={width} height={height} />
      </Sequence>

      {/* ===== Audit-question icons ===== */}
      <AuditIcon
        from={23.7}
        to={25.0}
        src={staticFile(`${jobPublicPath}/images/icon_phone_dinner_alpha.png`)}
        width={width}
        height={height}
      />
      <AuditIcon
        from={25.1}
        to={27.3}
        src={staticFile(`${jobPublicPath}/images/icon_thankyou_note_alpha.png`)}
        width={width}
        height={height}
      />
      <AuditIcon
        from={27.4}
        to={29.0}
        src={staticFile(`${jobPublicPath}/images/icon_10sec_watch_alpha.png`)}
        width={width}
        height={height}
      />
      <AuditIcon
        from={29.1}
        to={33.8}
        src={staticFile(`${jobPublicPath}/images/icon_meeting_room_alpha.png`)}
        width={width}
        height={height}
      />
      <AuditIcon
        from={33.9}
        to={35.9}
        src={staticFile(`${jobPublicPath}/images/icon_open_doorway_alpha.png`)}
        width={width}
        height={height}
      />

      {/* ===== 46.2-48.7s — Skills→Etiquette stat card ===== */}
      <Sequence from={t(46.2)} durationInFrames={t(2.6)}>
        <StatCardReveal
          src={staticFile(
            `${jobPublicPath}/images/stat_card_skills_etiquette_alpha.png`,
          )}
          width={width}
          height={height}
        />
        <Audio
          src={staticFile("sfx/transitions/whoosh_short_stove_dry.mp3")}
          volume={0.4}
        />
      </Sequence>

      {/* ===== 52.1-57.4s — Diane Gottsman introduction-card ===== */}
      <Sequence from={t(52.1)} durationInFrames={t(5.3)}>
        <DianeIntroCard
          src={staticFile(`${jobPublicPath}/images/diane_headshot.jpeg`)}
          width={width}
          height={height}
        />
        <Audio
          src={staticFile("sfx/transitions/whoosh_light_lifted_1.mp3")}
          volume={0.45}
        />
      </Sequence>

      {/* ===== 55.0-57.4s — Callback hold-frame ===== */}
      <Sequence from={t(55.0)} durationInFrames={t(2.4)}>
        <CallbackHoldFrame width={width} height={height} />
      </Sequence>
    </AbsoluteFill>
  );
};

export default JobOverlays;

/* ============================================================
 * Components
 * ========================================================== */

const EtiquetteIlliterateReveal: React.FC<{
  width: number;
  height: number;
}> = ({ width, height }) => {
  const frame = useCurrentFrame();
  // Scale-in spring with overshoot
  const scale = spring({
    frame,
    fps,
    from: 0.7,
    to: 1.0,
    config: { damping: 12, stiffness: 200, mass: 0.5 },
  });
  // Slight rotation snap on entry
  const rot = spring({
    frame,
    fps,
    from: -8,
    to: -3,
    config: { damping: 14, stiffness: 180 },
  });
  // Fade out tail
  const durFrames = Math.round(1.6 * fps);
  const opacity = interpolate(
    frame,
    [0, 3, durFrames - 8, durFrames - 1],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: `${height * 0.22}px`,
      }}
    >
      <div
        style={{
          opacity,
          transform: `scale(${scale}) rotate(${rot}deg)`,
          textAlign: "center",
          padding: "0 4%",
          width: "100%",
        }}
      >
        <div
          style={{
            fontFamily: FONT_TITLE,
            fontWeight: 900,
            fontStretch: "condensed",
            fontSize: width * 0.14,
            lineHeight: 0.9,
            letterSpacing: "-0.04em",
            color: COLOR_CREAM,
            textShadow: `0 ${width * 0.008}px ${width * 0.018}px rgba(0,0,0,0.55), 0 ${width * 0.003}px ${width * 0.006}px rgba(0,0,0,0.65)`,
            textTransform: "uppercase",
          }}
        >
          ETIQUETTE
          <br />
          ILLITERATE
        </div>
      </div>
    </AbsoluteFill>
  );
};

const AuditHeaderAndTimer: React.FC<{
  width: number;
  height: number;
}> = ({ width, height }) => {
  const frame = useCurrentFrame();
  const durFrames = Math.round(19.6 * fps);

  // Header pill fades in over first 0.5s and fades out in last 0.5s
  const headerOp = interpolate(
    frame,
    [0, 8, durFrames - 18, durFrames - 4],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" },
  );

  // Countdown: tick from 30 → 0 across the chunk; last 2s flash green at 00
  const seconds = frame / fps;
  const totalAuditSec = 17.9; // header starts at 20.0s, unlock arrives at 37.9s
  const remaining = Math.max(0, 30 - (seconds * 30) / totalAuditSec);
  const displayNum = Math.ceil(remaining);
  const unlocked = seconds >= 17.9;
  const flashOn = unlocked && Math.floor((seconds - 17.9) * 6) % 2 === 0;
  const timerColor = unlocked ? (flashOn ? COLOR_GREEN : COLOR_CREAM) : COLOR_CREAM;
  const timerBg = unlocked ? "rgba(46,125,50,0.85)" : "rgba(23,36,71,0.85)";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Audit header pill — top-center */}
      <div
        style={{
          position: "absolute",
          top: "5%",
          left: "50%",
          transform: "translateX(-50%)",
          opacity: headerOp,
          background: COLOR_RED,
          color: "white",
          fontFamily: FONT_TITLE,
          fontWeight: 800,
          fontSize: width * 0.04,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          padding: `${width * 0.018}px ${width * 0.04}px`,
          borderRadius: width * 0.06,
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          whiteSpace: "nowrap",
        }}
      >
        ⏱  30-SECOND ETIQUETTE AUDIT
      </div>

      {/* Countdown timer — upper-right corner */}
      <div
        style={{
          position: "absolute",
          top: "13%",
          right: "5%",
          opacity: headerOp,
          background: timerBg,
          color: timerColor,
          fontFamily: FONT_TITLE,
          fontWeight: 900,
          fontSize: width * 0.08,
          width: width * 0.16,
          height: width * 0.16,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          transition: "color 0.1s ease, background 0.1s ease",
        }}
      >
        {String(displayNum).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
};

const AuditIcon: React.FC<{
  from: number;
  to: number;
  src: string;
  width: number;
  height: number;
}> = ({ from, to, src, width, height }) => {
  const durFrames = Math.round((to - from) * fps);

  return (
    <>
      <Sequence from={t(from)} durationInFrames={1}>
        <Audio
          src={staticFile("sfx/ui/click_popup_bright.mp3")}
          volume={0.6}
        />
      </Sequence>

      <Sequence from={t(from)} durationInFrames={durFrames}>
        <AuditIconInner src={src} width={width} height={height} />
      </Sequence>
    </>
  );
};

const AuditIconInner: React.FC<{
  src: string;
  width: number;
  height: number;
}> = ({ src, width, height }) => {
  const frame = useCurrentFrame();

  // Pop-in spring scale
  const scale = spring({
    frame,
    fps,
    from: 0.3,
    to: 1.0,
    config: { damping: 10, stiffness: 200, mass: 0.6 },
  });

  // Continuous wiggle: subtle ±3° rotation + tiny vertical bob
  const wiggle = Math.sin((frame / fps) * 4.5) * 3;
  const bob = Math.sin((frame / fps) * 3.2) * 4;

  // Fade-in only (Sequence trims to durationInFrames)
  const opacity = interpolate(frame, [0, 4], [0, 1], {
    extrapolateRight: "clamp",
  });

  const size = width * 0.42;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "12%",
        left: "50%",
        transform: `translateX(-50%) translateY(${bob}px) scale(${scale}) rotate(${wiggle}deg)`,
        width: size,
        height: size,
        opacity,
        filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.35))",
      }}
    >
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
};

const StatCard85: React.FC<{
  jobPublicPath: string;
  width: number;
  height: number;
}> = ({ jobPublicPath, width, height }) => {
  const frame = useCurrentFrame();
  const seq = frame / fps; // seconds inside the 6.5s sequence (starts at 13.5s absolute)
  const durFrames = Math.round(6.5 * fps);

  // Card fade in / fade out
  const cardOpacity = interpolate(
    frame,
    [0, 6, durFrames - 8, durFrames - 1],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" },
  );

  // Gate weave — continuous subtle 35mm projector wobble. Base scale of 1.12
  // ensures the card always bleeds past the frame edges so the weave translate
  // + rotate never reveals the underlying avatar video.
  const weaveX = Math.sin(seq * 7.5) * 2.6 + Math.sin(seq * 17) * 0.6;
  const weaveY = Math.sin(seq * 5.3) * 1.8;
  const weaveRot = Math.sin(seq * 4.7) * 0.55;
  const weaveScale = 1.12 + Math.sin(seq * 6.1) * 0.004;

  // Logo entry beats (offsets relative to seq=0 which is absolute 13.5s)
  // Harvard pops in at abs 13.72 → seq 0.22
  // Stanford  at abs 14.18 → seq 0.68
  // Carnegie  at abs 14.88 → seq 1.38
  // 85% reveal at abs 16.66 → seq 3.16
  // ISN'T WORK at abs 18.66 → seq 5.16
  // IT'S YOU at abs 19.46 → seq 5.96
  const logoIn = (popAt: number) => {
    const popFrame = Math.round(popAt * fps);
    return spring({
      frame: frame - popFrame,
      fps,
      from: 0,
      to: 1,
      config: { damping: 9, stiffness: 220, mass: 0.55 },
    });
  };
  const harvardScale = logoIn(0.22);
  const stanfordScale = logoIn(0.68);
  const carnegieScale = logoIn(1.38);

  const bigStatOpacity = interpolate(
    frame,
    [Math.round(3.16 * fps) - 2, Math.round(3.16 * fps) + 6],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const bigStatScale = spring({
    frame: frame - Math.round(3.16 * fps),
    fps,
    from: 0.7,
    to: 1.0,
    config: { damping: 11, stiffness: 200, mass: 0.55 },
  });

  const isntWorkOpacity = interpolate(
    frame,
    [Math.round(5.16 * fps) - 2, Math.round(5.16 * fps) + 5],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const itsYouOpacity = interpolate(
    frame,
    [Math.round(5.96 * fps) - 2, Math.round(5.96 * fps) + 5],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: cardOpacity,
          transform: `translate(${weaveX}px, ${weaveY}px) rotate(${weaveRot}deg) scale(${weaveScale})`,
          transformOrigin: "center center",
          background:
            "radial-gradient(120% 100% at 50% 30%, #F8F2E6 0%, #EEE6D2 60%, #D9CDB1 100%)",
          paddingTop: `${width * 0.18}px`,
          paddingBottom: `${width * 0.06}px`,
          paddingLeft: `${width * 0.06}px`,
          paddingRight: `${width * 0.06}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: width * 0.02,
        }}
      >
        {/* Subtle film grain texture overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 30% 20%, rgba(0,0,0,0.04) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(0,0,0,0.04) 0%, transparent 50%)",
            mixBlendMode: "multiply",
            pointerEvents: "none",
          }}
        />

        {/* Header */}
        <div
          style={{
            fontFamily: FONT_TITLE,
            fontWeight: 700,
            fontSize: width * 0.04,
            color: COLOR_NAVY,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.7,
            marginTop: width * 0.01,
            marginBottom: width * 0.015,
          }}
        >
          Research from
        </div>

        {/* Three logo row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            gap: width * 0.02,
            width: "100%",
            marginBottom: width * 0.03,
          }}
        >
          <Img
            src={staticFile(`${jobPublicPath}/images/logo_harvard_alpha.png`)}
            style={{
              width: width * 0.24,
              height: width * 0.24,
              objectFit: "contain",
              transform: `scale(${harvardScale})`,
              transformOrigin: "center center",
              filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.18))",
            }}
          />
          <Img
            src={staticFile(`${jobPublicPath}/images/logo_stanford_alpha.png`)}
            style={{
              width: width * 0.24,
              height: width * 0.24,
              objectFit: "contain",
              transform: `scale(${stanfordScale})`,
              transformOrigin: "center center",
              filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.18))",
            }}
          />
          <Img
            src={staticFile(`${jobPublicPath}/images/logo_carnegie_alpha.png`)}
            style={{
              width: width * 0.24,
              height: width * 0.24,
              objectFit: "contain",
              transform: `scale(${carnegieScale})`,
              transformOrigin: "center center",
              filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.18))",
            }}
          />
        </div>

        {/* Divider */}
        <div
          style={{
            width: "55%",
            height: 2,
            background: COLOR_NAVY,
            opacity: 0.25 * bigStatOpacity,
            margin: `${width * 0.01}px 0`,
          }}
        />

        {/* Big 85% */}
        <div
          style={{
            opacity: bigStatOpacity,
            transform: `scale(${bigStatScale})`,
            fontFamily: FONT_TITLE,
            fontWeight: 900,
            fontSize: width * 0.36,
            lineHeight: 0.85,
            color: COLOR_NAVY,
            letterSpacing: "-0.05em",
            textShadow: `0 ${width * 0.006}px ${width * 0.012}px rgba(0,0,0,0.18)`,
            marginTop: width * 0.005,
          }}
        >
          85%
        </div>
        <div
          style={{
            opacity: bigStatOpacity,
            fontFamily: FONT_TITLE,
            fontWeight: 700,
            fontSize: width * 0.045,
            color: COLOR_NAVY,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginTop: width * 0.005,
            opacity: bigStatOpacity * 0.85,
          }}
        >
          of job success
        </div>

        {/* Reveal lines */}
        <div
          style={{
            opacity: isntWorkOpacity,
            fontFamily: FONT_TITLE,
            fontWeight: 900,
            fontSize: width * 0.105,
            lineHeight: 1.0,
            color: COLOR_RUST,
            letterSpacing: "-0.02em",
            textTransform: "uppercase",
            marginTop: width * 0.025,
          }}
        >
          ISN'T WORK.
        </div>
        <div
          style={{
            opacity: itsYouOpacity,
            fontFamily: FONT_TITLE,
            fontWeight: 900,
            fontSize: width * 0.13,
            lineHeight: 1.0,
            color: COLOR_NAVY,
            letterSpacing: "-0.025em",
            textTransform: "uppercase",
            marginTop: width * 0.01,
          }}
        >
          IT'S YOU.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PhoneRedFlash: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  // Pulse the opacity: high → low → high to suggest a warning flash.
  const pulse = 0.4 + 0.55 * Math.abs(Math.sin((frame / fps) * 12));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Video
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          mixBlendMode: "screen",
          opacity: pulse,
          filter: "saturate(1.5) brightness(1.2)",
        }}
        muted
      />
    </AbsoluteFill>
  );
};

const StatCardReveal: React.FC<{
  src: string;
  width: number;
  height: number;
}> = ({ src, width, height }) => {
  const frame = useCurrentFrame();
  const durFrames = Math.round(2.6 * fps);

  // Slide in from right
  const slide = spring({
    frame,
    fps,
    from: 1,
    to: 0,
    config: { damping: 14, stiffness: 130, mass: 0.6 },
  });
  // Fade tail
  const opacity = interpolate(
    frame,
    [0, 5, durFrames - 10, durFrames - 1],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" },
  );

  const cardWidth = width * 0.72;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateX(${slide * width * 0.7}px)`,
          width: cardWidth,
          filter: "drop-shadow(0 16px 50px rgba(0,0,0,0.45))",
        }}
      >
        <Img
          src={src}
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </div>
    </AbsoluteFill>
  );
};

const DianeIntroCard: React.FC<{
  src: string;
  width: number;
  height: number;
}> = ({ src, width, height }) => {
  const frame = useCurrentFrame();
  const durFrames = Math.round(5.3 * fps);

  // Slide in from left lower-third
  const slide = spring({
    frame,
    fps,
    from: 1,
    to: 0,
    config: { damping: 14, stiffness: 140, mass: 0.5 },
  });
  const opacity = interpolate(
    frame,
    [0, 6, durFrames - 12, durFrames - 1],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" },
  );

  const cardW = width * 0.86;
  const photoSize = width * 0.22;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "9%",
          transform: `translateX(calc(-50% - ${slide * width * 0.7}px))`,
          opacity,
          width: cardW,
          background: COLOR_NAVY,
          borderRadius: width * 0.025,
          padding: `${width * 0.025}px ${width * 0.03}px`,
          display: "flex",
          alignItems: "center",
          gap: width * 0.03,
          boxShadow: "0 16px 50px rgba(0,0,0,0.55)",
          border: `2px solid ${COLOR_CREAM}`,
        }}
      >
        <div
          style={{
            width: photoSize,
            height: photoSize,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            border: `3px solid ${COLOR_CREAM}`,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center top",
            }}
          />
        </div>
        <div style={{ flex: 1, color: COLOR_CREAM }}>
          <div
            style={{
              fontFamily: FONT_TITLE,
              fontWeight: 800,
              fontSize: width * 0.058,
              letterSpacing: "-0.01em",
              lineHeight: 1.05,
              color: COLOR_CREAM,
            }}
          >
            DIANE GOTTSMAN
          </div>
          <div
            style={{
              fontFamily: FONT_SERIF,
              fontStyle: "italic",
              fontSize: width * 0.033,
              color: COLOR_CREAM,
              opacity: 0.88,
              marginTop: width * 0.004,
              lineHeight: 1.15,
            }}
          >
            Founder, The Protocol School of Texas
          </div>
          <div
            style={{
              fontFamily: FONT_TITLE,
              fontWeight: 700,
              fontSize: width * 0.024,
              color: COLOR_RUST,
              letterSpacing: "0.06em",
              marginTop: width * 0.008,
              textTransform: "uppercase",
            }}
          >
            protocolschooloftexas.com
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CallbackHoldFrame: React.FC<{ width: number; height: number }> = ({
  width,
  height,
}) => {
  const frame = useCurrentFrame();
  const durFrames = Math.round(2.4 * fps);

  const opacity = interpolate(
    frame,
    [0, 15, durFrames - 4, durFrames - 1],
    [0, 1, 1, 1],
    { extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: "8%",
          left: "50%",
          transform: "translateX(-50%)",
          opacity,
          width: "90%",
          textAlign: "center",
          fontFamily: FONT_SERIF,
          fontStyle: "italic",
          fontSize: width * 0.055,
          color: COLOR_CREAM,
          letterSpacing: "0.01em",
          lineHeight: 1.2,
          textShadow: `0 2px 8px rgba(0,0,0,0.7), 0 0 ${width * 0.02}px rgba(0,0,0,0.5)`,
        }}
      >
        "You can't win a room
        <br />
        you were never taught to read."
      </div>
    </AbsoluteFill>
  );
};
