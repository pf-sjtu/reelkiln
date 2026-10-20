import { Composition } from "remotion";
import { Captioned } from "./Captioned";
import { CaptionedPropsSchema, defaultProps } from "./schema";
import {
  TextCard,
  TextCardPropsSchema,
  defaultTextCardProps,
} from "./TextCard";
import {
  PillCaption,
  PillCaptionPropsSchema,
  defaultPillCaptionProps,
} from "./PillCaption";
import {
  Carousel,
  CarouselSlidePropsSchema,
  defaultCarouselSlideProps,
} from "./Carousel";
import {
  DiagramReel,
  DiagramReelPropsSchema,
  defaultDiagramReelProps,
} from "./DiagramReel";

/**
 * Single composition: "Captioned".
 * Width/height/fps/duration are computed from input props via
 * calculateMetadata so the caller can render at any aspect ratio.
 */
export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="Captioned"
        component={Captioned}
        // Placeholders — real values come from calculateMetadata below.
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={900}
        schema={CaptionedPropsSchema}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => {
          const fps = props.fps ?? 30;
          return {
            width: props.width ?? 1080,
            height: props.height ?? 1920,
            fps,
            durationInFrames: Math.max(1, Math.round(props.durationSeconds * fps)),
          };
        }}
      />
      <Composition
        id="TextCard"
        component={TextCard}
        width={720}
        height={1280}
        fps={30}
        durationInFrames={180}
        schema={TextCardPropsSchema}
        defaultProps={defaultTextCardProps}
        calculateMetadata={({ props }) => {
          const fps = props.fps ?? 30;
          return {
            width: props.width ?? 720,
            height: props.height ?? 1280,
            fps,
            durationInFrames: Math.max(1, Math.round(props.durationSeconds * fps)),
          };
        }}
      />
      <Composition
        id="PillCaption"
        component={PillCaption}
        width={720}
        height={1280}
        fps={30}
        durationInFrames={180}
        schema={PillCaptionPropsSchema}
        defaultProps={defaultPillCaptionProps}
        calculateMetadata={({ props }) => {
          const fps = props.fps ?? 30;
          return {
            width: props.width ?? 720,
            height: props.height ?? 1280,
            fps,
            durationInFrames: Math.max(1, Math.round(props.durationSeconds * fps)),
          };
        }}
      />
      {/*
       * `Carousel` — single Instagram swipe-slide at 1080×1350. Renders ONE
       * slide per invocation; the Python orchestrator calls `npx remotion still`
       * N times (once per slide in the job's carousel.json).
       *
       * fps + durationInFrames are placeholders — `remotion still` only needs
       * one frame, so duration is fixed at 1 frame.
       */}
      <Composition
        id="Carousel"
        component={Carousel}
        width={1080}
        height={1350}
        fps={30}
        durationInFrames={1}
        schema={CarouselSlidePropsSchema}
        defaultProps={defaultCarouselSlideProps}
      />
      <Composition
        id="DiagramReel"
        component={DiagramReel}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={2364}
        schema={DiagramReelPropsSchema}
        defaultProps={defaultDiagramReelProps}
        calculateMetadata={({ props }) => {
          const fps = props.fps ?? 30;
          return {
            width: props.width ?? 1080,
            height: props.height ?? 1920,
            fps,
            durationInFrames: Math.max(1, Math.round(props.durationSeconds * fps)),
          };
        }}
      />
    </>
  );
};
