import {
  AbsoluteFill,
  Audio,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";
import {
  createTikTokStyleCaptions,
  type Caption,
} from "@remotion/captions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaptionPage } from "./CaptionPage";
import { Hook, LowerThird, UrlPill } from "./Overlays";
import { DataViz } from "./dataviz";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import type { CaptionToken, CaptionedProps } from "./schema";
// Per-job overlays — resolved via the _currentJobOverlays.tsx symlink that
// preview.py / remotion_render.py set up before invoking Remotion.
// When no job is active the imported component is a no-op stub.
import JobOverlays from "./_currentJobOverlays";

// Load fonts (blocks render until ready).
loadInter("normal", { weights: ["700", "800", "900"], subsets: ["latin"] });

// Defaults — overridden per-render via props.captionStyle.
const DEFAULT_SWITCH_CAPTIONS_EVERY_MS = 1100;

// Captions in our transcripts come as {word, start, end} in seconds.
// @remotion/captions expects:
//   { text: string (with leading space), startMs, endMs, timestampMs, confidence }
const tokensToCaptions = (tokens: CaptionToken[]): Caption[] => {
  return tokens.map((t, i) => ({
    text: (i === 0 ? "" : " ") + t.word,
    startMs: t.start * 1000,
    endMs: t.end * 1000,
    timestampMs: ((t.start + t.end) / 2) * 1000,
    confidence: null,
  }));
};

const useCaptions = (
  inline: CaptionToken[] | undefined,
  path: string | undefined,
): CaptionToken[] | null => {
  const [captions, setCaptions] = useState<CaptionToken[] | null>(
    inline && inline.length ? inline : null,
  );
  const [handle] = useState<number | null>(() => {
    if (inline && inline.length) return null;
    if (!path) return null;
    return delayRender(`Loading captions from ${path}`);
  });

  const fetchCaptions = useCallback(async () => {
    if (!path || handle == null) return;
    try {
      // Path is relative to agent/remotion/public/ (e.g. "_jobs/<id>/transcript.json").
      // staticFile() resolves to a Chromium-loadable URL inside the render.
      const res = await fetch(staticFile(path));
      const data = await res.json();
      const words: CaptionToken[] = (data.words || []).map((w: any) => ({
        word: w.word ?? w.text ?? "",
        start: Number(w.start) || 0,
        end: Number(w.end) || 0,
      }));
      setCaptions(words);
      continueRender(handle);
    } catch (e) {
      cancelRender(e as Error);
    }
  }, [path, handle]);

  useEffect(() => {
    fetchCaptions();
  }, [fetchCaptions]);

  return captions;
};

// Derive jobPublicPath when not explicitly passed: dirname(videoPath).
// videoPath is "_jobs/<id>/final_raw.mp4" → jobPublicPath = "_jobs/<id>".
const deriveJobPublicPath = (videoPath: string): string => {
  const ix = videoPath.lastIndexOf("/");
  return ix > 0 ? videoPath.slice(0, ix) : videoPath;
};

/**
 * Renders the base avatar video with optional Ken Burns + punch-zoom transforms.
 * Generic — driven by props.videoTransform from style_directives.json.
 * Renders 1:1 (no transform) when videoTransform is omitted.
 */
const TransformedVideo: React.FC<{
  videoPath: string;
  durationSeconds: number;
  videoTransform?: CaptionedProps["videoTransform"];
}> = ({ videoPath, durationSeconds, videoTransform }) => {
  const frameNo = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tSec = frameNo / fps;

  // Ken Burns — slow scale ramp across full duration.
  const kb = videoTransform?.ken_burns;
  const kbScale = kb
    ? interpolate(tSec, [0, durationSeconds], [kb.start_scale ?? 1, kb.end_scale ?? 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  // Punch-zooms — discrete spikes that scale up then back over duration_sec.
  let pzMultiplier = 1;
  for (const pz of videoTransform?.punch_zooms ?? []) {
    const dur = pz.duration_sec ?? 0.4;
    const peak = pz.scale ?? 1.05;
    const half = dur / 2;
    if (tSec >= pz.at_sec - half && tSec <= pz.at_sec + half) {
      // Triangle wave: ramp 1 → peak → 1 over the window
      const local = (tSec - (pz.at_sec - half)) / dur;        // 0..1 across window
      const tri = local < 0.5 ? local * 2 : (1 - local) * 2;  // 0..1..0
      const spikeScale = 1 + (peak - 1) * tri;
      pzMultiplier = Math.max(pzMultiplier, spikeScale);
    }
  }

  // Focus track — keyframed zoom toward an arbitrary focal point (x,y). This is
  // the screen-recording demo mechanic: unlike Ken Burns / punch-zoom (centered),
  // it moves the transform-origin so the camera can snap onto the exact button /
  // panel being acted on, hold, then ease out. Keyframes are interpolated with a
  // cubic ease-in-out by default. When present, it OVERRIDES Ken Burns as the
  // base scale (punch-zooms still multiply on top for extra punctuation).
  const ft = videoTransform?.focus_track;
  let focusScale = 1;
  let originX = 0.5;
  let originY = 0.5;
  const hasFocus = !!ft && ft.length > 0;
  if (hasFocus) {
    const kfs = [...ft!].sort((a, b) => a.at_sec - b.at_sec);
    const first = kfs[0];
    const last = kfs[kfs.length - 1];
    if (tSec <= first.at_sec) {
      focusScale = first.scale ?? 1; originX = first.x ?? 0.5; originY = first.y ?? 0.5;
    } else if (tSec >= last.at_sec) {
      focusScale = last.scale ?? 1; originX = last.x ?? 0.5; originY = last.y ?? 0.5;
    } else {
      let a = kfs[0];
      let b = kfs[1];
      for (let i = 0; i < kfs.length - 1; i++) {
        if (tSec >= kfs[i].at_sec && tSec <= kfs[i + 1].at_sec) { a = kfs[i]; b = kfs[i + 1]; break; }
      }
      const span = b.at_sec - a.at_sec || 1e-6;
      const p = (tSec - a.at_sec) / span;                       // 0..1 within the pair
      const eased = b.ease === "linear"
        ? p
        : p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;  // cubic in-out
      const lerp = (u: number, v: number) => u + (v - u) * eased;
      focusScale = lerp(a.scale ?? 1, b.scale ?? 1);
      originX = lerp(a.x ?? 0.5, b.x ?? 0.5);
      originY = lerp(a.y ?? 0.5, b.y ?? 0.5);
    }
  }

  const scale = (hasFocus ? focusScale : kbScale) * pzMultiplier;
  const transform = scale === 1 ? undefined : `scale(${scale})`;
  const transformOrigin = hasFocus
    ? `${(originX * 100).toFixed(2)}% ${(originY * 100).toFixed(2)}%`
    : "center center";
  const objectFit = videoTransform?.fit ?? "contain";
  const bg = videoTransform?.background_color;
  const backgroundGradient = videoTransform?.background_gradient;
  const backgroundBlurPx = videoTransform?.background_blur_px ?? 0;
  const frame = videoTransform?.frame;

  // ── Browser-card treatment ────────────────────────────────────────────────
  // The source floats in a rounded, shadowed card on the brand background. The
  // focus_track transform is applied to the card+bg GROUP so a punch scales the
  // whole thing toward the focal point (the card grows until the target fills).
  if (frame) {
    const inset = (frame.inset_pct ?? 4) / 100;
    const topPct = (frame.top_pct ?? 20) / 100;
    const cardW = width * (1 - 2 * inset);
    const chromeH = frame.chrome === "bar" ? Math.round(cardW * 0.055) : 0;
    const cardH = cardW / (frame.source_aspect ?? 1.7777) + chromeH;

    return (
      <AbsoluteFill style={{
        overflow: "hidden",
        backgroundColor: bg ?? "#eaeef3",
        backgroundImage: backgroundGradient,
      }}>
        <AbsoluteFill style={{ transform, transformOrigin }}>
          <div
            style={{
              position: "absolute",
              left: width * inset,
              top: height * topPct,
              width: cardW,
              height: cardH,
              borderRadius: frame.radius_px ?? 28,
              overflow: "hidden",
              backgroundColor: "#ffffff",
              boxShadow: frame.shadow === false ? undefined : "0 24px 80px rgba(15,23,42,0.22)",
              border: "1px solid rgba(15,23,42,0.08)",
            }}
          >
            {frame.chrome === "bar" && (
              <div
                style={{
                  height: chromeH,
                  background: "#1b1f24",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: chromeH * 0.55,
                  gap: chromeH * 0.28,
                }}
              >
                {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                  <div key={c} style={{ width: chromeH * 0.22, height: chromeH * 0.22, borderRadius: "50%", background: c }} />
                ))}
                {frame.chrome_label && (
                  <div style={{ color: "#c8ced6", fontSize: chromeH * 0.34, marginLeft: chromeH * 0.6, fontFamily: "Inter, sans-serif" }}>
                    {frame.chrome_label}
                  </div>
                )}
              </div>
            )}
            <Video
              src={staticFile(videoPath)}
              style={{ width: "100%", height: cardH - chromeH, objectFit: "cover" }}
            />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{
      overflow: "hidden",
      backgroundColor: bg,
      backgroundImage: backgroundGradient,
    }}>
      <AbsoluteFill style={{ transform, transformOrigin }}>
        {objectFit === "contain" && backgroundBlurPx > 0 ? (
          <Video
            muted
            src={staticFile(videoPath)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: `blur(${backgroundBlurPx}px)`,
              transform: "scale(1.06)",
            }}
          />
        ) : null}
        <Video
          src={staticFile(videoPath)}
          style={{ width: "100%", height: "100%", objectFit }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Captioned: React.FC<CaptionedProps> = (props) => {
  const { fps, width, height } = useVideoConfig();
  const captions = useCaptions(props.captionTokens, props.captionsPath);
  const jobPublicPath = props.jobPublicPath ?? deriveJobPublicPath(props.videoPath);

  const switchMs = props.captionStyle?.switch_ms ?? DEFAULT_SWITCH_CAPTIONS_EVERY_MS;

  const pages = useMemo(() => {
    if (!captions || !props.showCaptions) return [];
    const remotionCaptions = tokensToCaptions(captions);
    const rawPages = createTikTokStyleCaptions({
      captions: remotionCaptions,
      combineTokensWithinMilliseconds: switchMs,
    }).pages;
    // Sentence-natural break: split any page mid-page at a sentence-ending
    // punctuation mark. This prevents "of you that fit? THAT is" awkward breaks
    // and lands captions on natural clauses. Opt-out via captionStyle.break_on_sentence=false.
    if (props.captionStyle?.break_on_sentence === false) return rawPages;
    const SENTENCE_END = /[.?!]\s*$|—\s*$/;
    const split: typeof rawPages = [];
    for (const page of rawPages) {
      const toks = page.tokens;
      if (!toks || toks.length === 0) { split.push(page); continue; }
      let groupStart = 0;
      for (let i = 0; i < toks.length; i++) {
        const txt = (toks[i].text ?? "").trim();
        const endsSentence = SENTENCE_END.test(txt);
        const isLast = i === toks.length - 1;
        if (endsSentence && !isLast) {
          const sub = toks.slice(groupStart, i + 1);
          split.push({
            startMs: sub[0].fromMs,
            tokens: sub,
            text: sub.map((t) => t.text).join(""),
            durationMs: sub[sub.length - 1].toMs - sub[0].fromMs,
          });
          groupStart = i + 1;
        }
      }
      if (groupStart < toks.length) {
        const sub = toks.slice(groupStart);
        split.push({
          startMs: sub[0].fromMs,
          tokens: sub,
          text: sub.map((t) => t.text).join(""),
          durationMs: sub[sub.length - 1].toMs - sub[0].fromMs,
        });
      }
    }
    return split;
  }, [captions, props.showCaptions, switchMs, props.captionStyle?.break_on_sentence]);

  // Convert dB to linear gain for the bed.
  const bedVolume = Math.pow(10, (props.audioBedVolumeDb ?? -22) / 20);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Base layer: the talking-head video. videoPath is relative to public/.
          Wrapped in TransformedVideo so we can apply optional Ken Burns / punch-zooms
          driven by style_directives.json (props.videoTransform). */}
      <TransformedVideo
        videoPath={props.videoPath}
        durationSeconds={props.durationSeconds}
        videoTransform={props.videoTransform}
      />

      {/* Optional music bed under the speech. Path is relative to public/.
          The bed is loop-trimmed by Remotion to the composition duration. */}
      {props.audioBedPath ? (
        <Audio src={staticFile(props.audioBedPath)} volume={bedVolume} />
      ) : null}

      {/* Captions layer — zIndex lifts it above full-screen per-job b-roll
          (JobOverlays), so captions stay legible on top of brand-image beats.
          Small foreground chrome (logo/lower-thirds) is placed away from the
          caption band, so being below captions is visually inconsequential. */}
      {props.showCaptions && pages.length > 0 && (
        <AbsoluteFill style={{ zIndex: 30 }}>
          {pages.map((page, index) => {
            const next = pages[index + 1];
            const startFrame = (page.startMs / 1000) * fps;
            const endFrame = Math.min(
              next ? (next.startMs / 1000) * fps : Infinity,
              startFrame + (switchMs / 1000) * fps,
            );
            const duration = endFrame - startFrame;
            if (duration <= 0) return null;
            return (
              <Sequence
                key={index}
                from={Math.round(startFrame)}
                durationInFrames={Math.round(duration)}
                layout="none"
              >
                <CaptionPage page={page} style={props.captionStyle} />
              </Sequence>
            );
          })}
        </AbsoluteFill>
      )}

      {/* Legacy overlays layer: hook, lower-third, URL pill (auto + manual). */}
      {(props.overlays || []).map((o, i) => {
        const startFrame = Math.round(o.start * fps);
        const duration = Math.max(1, Math.round((o.end - o.start) * fps));
        const Component =
          o.kind === "hook" ? Hook : o.kind === "url" ? UrlPill : LowerThird;
        return (
          <Sequence
            key={`${o.kind}-${i}`}
            from={startFrame}
            durationInFrames={duration}
            layout="none"
          >
            <Component text={o.text} />
          </Sequence>
        );
      })}

      {/* Data-viz layer: animated stat / chart overlays (see dataviz.tsx). */}
      {(props.dataviz || []).map((d, i) => {
        const startFrame = Math.round(d.start * fps);
        const duration = Math.max(1, Math.round((d.end - d.start) * fps));
        return (
          <Sequence
            key={`viz-${d.kind}-${i}`}
            from={startFrame}
            durationInFrames={duration}
            layout="none"
          >
            <DataViz item={d} />
          </Sequence>
        );
      })}

      {/* Per-job overlays layer (top of stack). Loaded from the
          _currentJobOverlays.tsx symlink. The stub renders nothing when no
          job-specific overlays.tsx is active. */}
      <JobOverlays
        jobPublicPath={jobPublicPath}
        durationSeconds={props.durationSeconds}
        width={width}
        height={height}
        fps={fps}
      />
    </AbsoluteFill>
  );
};
