/**
 * `Carousel` composition — single Instagram swipe-slide for the @josephchinbuilds
 * (Coaching Gems) account. Renders ONE slide per composition invocation; the
 * Python orchestrator (`agent/tools/render_carousel.py`) calls `npx remotion still`
 * N times, once per slide in `<job_dir>/carousel.json`.
 *
 * Output: 1080×1350 PNG (IG portrait 4:5).
 *
 * Style: `coaching_gems_v1` — cream paper #F2EBDC, single burnt-orange ink #C84A1E,
 * intaglio engraving illustrations. See agent/skills/carousel_styles/coaching_gems_v1.md
 * for the locked aesthetic spec.
 *
 * Layout (1350px tall):
 *   y 0-270    — top zone (narration prose for beats, header chip for cover)
 *   y 270-1080 — illustration band (810px; receives 1080×1620 source cropped to central 1350)
 *   y 1080-1280 — bottom zone (cover headline/tagline; closing stamp+tagline+url)
 *   y 1280-1330 — handle footer (@josephchinbuilds)
 */

import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { z } from "zod";
import { loadFont as loadDMSerifDisplay } from "@remotion/google-fonts/DMSerifDisplay";
import { loadFont as loadEBGaramond } from "@remotion/google-fonts/EBGaramond";

// ── Locked palette / typography (inherits from coaching_gems_v1 style pack) ──
const CREAM = "#F2EBDC";
const INK = "#1A1410"; // deep ink-black for body narration (legible on cream)
const ORANGE = "#C84A1E"; // burnt-orange emphasis + handle

// Pre-load fonts the carousel uses (DM Serif Display = stamp-register slab serif;
// EB Garamond = classical book-typography body for narration prose).
const dmSerif = loadDMSerifDisplay("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const dmSerifItalic = loadDMSerifDisplay("italic", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const ebGaramond = loadEBGaramond("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
const ebGaramondItalic = loadEBGaramond("italic", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;

// ── Schema ───────────────────────────────────────────────────────────────────

export const CarouselSlidePropsSchema = z.object({
  /** 1-indexed slide number — used for default font-size scaling and debug. */
  index: z.number(),
  /** Layout variant. */
  kind: z.enum(["cover", "beat", "closing"]),
  /** Path to the illustration PNG, RELATIVE to agent/remotion/public/. */
  illustrationPath: z.string(),
  /** Handle to render in the bottom footer (every slide). */
  handle: z.string().default("@josephchinbuilds"),

  // ── beat + closing fields ──
  /**
   * Narration prose. `[[double-bracket phrases]]` render in burnt-orange ink
   * (see coaching_gems_v1.md — Emphasis Markup).
   */
  narration: z.string().optional(),

  // ── cover-specific fields ──
  /** Small editorial chip at the top, e.g. "COACHING GEMS · ISSUE 11". */
  headerChip: z.string().optional(),
  /** Big serif headline at the bottom, e.g. "ALISSA FINERMAN". */
  headline: z.string().optional(),
  /** Italic tagline under the headline. */
  tagline: z.string().optional(),

  // ── closing-specific fields ──
  /** Show the Coaching Gems wordmark stamp in the bottom zone. */
  showStamp: z.boolean().optional(),
  /** Path to the stamp PNG, RELATIVE to public/. */
  stampPath: z.string().optional(),
  /** Brand tagline "ONE COACH · ONE IDEA · ONE MINUTE". */
  brandTagline: z.string().optional(),
  /** Brand URL "alissafinerman.com". */
  brandUrl: z.string().optional(),
});

export type CarouselSlideProps = z.infer<typeof CarouselSlidePropsSchema>;

export const defaultCarouselSlideProps: CarouselSlideProps = {
  index: 1,
  kind: "beat",
  illustrationPath: "",
  handle: "@josephchinbuilds",
  narration: "Sample [[narration]] with an emphasis phrase.",
};

// ── Emphasis-phrase parser ────────────────────────────────────────────────────

const renderEmphasis = (text: string): React.ReactNode[] => {
  // Split on [[...]] while keeping the delimiters.
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[\[(.+)\]\]$/);
    if (m) {
      return (
        <span key={i} style={{ color: ORANGE, fontStyle: "italic", fontFamily: ebGaramondItalic }}>
          {m[1]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
};

// ── Illustration (centered, cropped from 2:3 source to fit the 810px band) ───

const IllustrationBand: React.FC<{ src: string }> = ({ src }) => {
  // Source illustrations are 2:3 (1080×1620). The composition is 1080×1350.
  // We want the central 50% of the source (the subject) to occupy y 270-1080
  // of the composition (810px tall). The source's central 50% is rows 405-1215
  // of the 1620px. By placing the image at y = -135px with width=1080, the
  // visible 0-1350 of the composition shows source rows 135-1485 — which
  // includes 270px of cream margin top, the 810px central subject, and
  // 270px of cream margin bottom. Perfect alignment with our typography zones.
  return (
    <div
      style={{
        position: "absolute",
        top: -135,
        left: 0,
        width: 1080,
        height: 1620,
      }}
    >
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
};

// ── Slide variants ────────────────────────────────────────────────────────────

const BeatSlide: React.FC<CarouselSlideProps> = ({ narration, illustrationPath }) => {
  const text = narration ?? "";
  // Dynamic font-size: shorter narration → larger type. Cap at 56, floor at 36.
  const fontSize = Math.max(36, Math.min(56, Math.round(2400 / Math.sqrt(text.length))));
  return (
    <>
      <IllustrationBand src={staticFile(illustrationPath)} />
      <div
        style={{
          position: "absolute",
          top: 30,
          left: 60,
          width: 960,
          maxHeight: 220,
          textAlign: "center",
          fontFamily: ebGaramond,
          fontWeight: 500,
          fontSize,
          lineHeight: 1.25,
          color: INK,
          letterSpacing: "-0.005em",
        }}
      >
        {renderEmphasis(text)}
      </div>
    </>
  );
};

const CoverSlide: React.FC<CarouselSlideProps> = ({
  headerChip,
  headline,
  tagline,
  illustrationPath,
}) => {
  return (
    <>
      <IllustrationBand src={staticFile(illustrationPath)} />
      {/* Top header chip */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 0,
          width: 1080,
          textAlign: "center",
          fontFamily: ebGaramond,
          fontWeight: 600,
          fontSize: 28,
          letterSpacing: "0.22em",
          color: ORANGE,
          textTransform: "uppercase",
        }}
      >
        {headerChip}
      </div>
      {/* Bottom headline + tagline */}
      <div
        style={{
          position: "absolute",
          top: 1100,
          left: 0,
          width: 1080,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: dmSerif,
            fontSize: 76,
            lineHeight: 1.0,
            color: INK,
            letterSpacing: "0.02em",
          }}
        >
          {headline}
        </div>
        {tagline && (
          <div
            style={{
              marginTop: 18,
              fontFamily: ebGaramondItalic,
              fontStyle: "italic",
              fontSize: 32,
              color: INK,
              letterSpacing: "0.01em",
            }}
          >
            {tagline}
          </div>
        )}
      </div>
    </>
  );
};

const ClosingSlide: React.FC<CarouselSlideProps> = ({
  narration,
  illustrationPath,
  stampPath,
  brandTagline,
  brandUrl,
}) => {
  const text = narration ?? "";
  const fontSize = Math.max(32, Math.min(46, Math.round(2200 / Math.sqrt(text.length))));
  return (
    <>
      <IllustrationBand src={staticFile(illustrationPath)} />
      {/* Top narration */}
      <div
        style={{
          position: "absolute",
          top: 30,
          left: 60,
          width: 960,
          textAlign: "center",
          fontFamily: ebGaramond,
          fontWeight: 500,
          fontSize,
          lineHeight: 1.25,
          color: INK,
        }}
      >
        {renderEmphasis(text)}
      </div>
      {/* Bottom stamp + brand tagline + url */}
      {stampPath && (
        <div
          style={{
            position: "absolute",
            top: 1090,
            left: 0,
            width: 1080,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <Img
            src={staticFile(stampPath)}
            style={{ width: 140, height: 140, objectFit: "contain" }}
          />
          {brandTagline && (
            <div
              style={{
                marginTop: 6,
                fontFamily: ebGaramond,
                fontWeight: 600,
                fontSize: 18,
                letterSpacing: "0.20em",
                color: ORANGE,
                textTransform: "uppercase",
              }}
            >
              {brandTagline}
            </div>
          )}
          {brandUrl && (
            <div
              style={{
                marginTop: 6,
                fontFamily: dmSerifItalic,
                fontStyle: "italic",
                fontSize: 22,
                color: INK,
              }}
            >
              {brandUrl}
            </div>
          )}
        </div>
      )}
    </>
  );
};

// ── Root Carousel component ──────────────────────────────────────────────────

export const Carousel: React.FC<CarouselSlideProps> = (props) => {
  const { kind, handle } = props;
  return (
    <AbsoluteFill style={{ backgroundColor: CREAM }}>
      {/* Subtle paper-grain texture could go here as a future enhancement. */}
      {kind === "cover" && <CoverSlide {...props} />}
      {kind === "beat" && <BeatSlide {...props} />}
      {kind === "closing" && <ClosingSlide {...props} />}
      {/* Handle footer — every slide. */}
      <div
        style={{
          position: "absolute",
          top: 1290,
          left: 0,
          width: 1080,
          textAlign: "center",
          fontFamily: ebGaramondItalic,
          fontStyle: "italic",
          fontSize: 22,
          color: ORANGE,
          letterSpacing: "0.05em",
        }}
      >
        {handle}
      </div>
    </AbsoluteFill>
  );
};
