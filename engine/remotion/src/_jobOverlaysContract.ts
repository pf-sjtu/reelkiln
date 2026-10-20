/**
 * The contract every per-job overlays.tsx file MUST satisfy.
 *
 * Per-job overlay files live at <job_dir>/overlays.tsx. The pipeline
 * symlinks the active job's file into agent/remotion/src/_currentJobOverlays.tsx
 * before render or preview, and Captioned.tsx imports JobOverlays from there.
 *
 * The component receives only the jobPublicPath and canvas metadata. It is
 * responsible for fetching whatever per-job data it needs (transcript,
 * motion plan, asset manifests) via staticFile() inside its own component
 * body — see agent/skills/overlay_authoring_guide.md §6 for the pattern.
 */

export type JobOverlaysProps = {
  /** Path RELATIVE to agent/remotion/public/ — e.g. "_jobs/teuwen.com-20260504-zgrdxj". */
  jobPublicPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
};
