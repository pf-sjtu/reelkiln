import type { CaptionStyle } from "./schema";
import presets from "./caption_presets.json";

/**
 * Named caption presets — the ONLY blessed caption looks.
 *
 * This file (with caption_presets.json as the data source of truth) is read by
 * BOTH the Remotion render and tools/compose_render.py. An agent making a video
 * must DELIBERATELY pick one of these by name (style_directives.json
 * `"caption_preset": "<name>"` or `--caption-preset <name>`). There is no silent
 * default — compose_render hard-errors if captions are on but no preset (or an
 * explicit caption_style) was chosen. See skills/caption_presets.md.
 *
 * Reference renders of each preset live in examples/caption-presets/<name>.mp4.
 *
 *   tiktok      — white sentence case on a soft black pill. The safe, neutral default.
 *   clean       — thin white text, no box, tight tracking. Premium / minimal.
 *   mono        — lowercase monospace on a dark chip. Tech / build-in-public.
 *   highlighter — active word gets a sky-blue marker box; rest stay white. Punchy, readable.
 *   editorial   — italic Playfair serif, no box. Luxury / thought-leader.
 *   handwritten — Caveat script with a pale-yellow active word. Warm / personal.
 */
export const CAPTION_PRESETS = presets as Record<string, CaptionStyle>;

export type CaptionPresetName = keyof typeof presets;

export const CAPTION_PRESET_NAMES = Object.keys(presets) as CaptionPresetName[];
