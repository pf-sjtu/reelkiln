/**
 * Social-platform UI red zones for vertical 9:16 video (1080×1920).
 *
 * These are areas where the platform overlays its OWN UI (username, like
 * counter, comment button, share button, captions, share sheet etc.) on top
 * of the video at playback time. Anything we draw inside these rectangles
 * gets covered or competes for attention.
 *
 * Used by:
 *   - agent/tools/preflight.py — face/overlay collision check before render
 *   - Future: dynamic overlay placement that auto-shifts away from these
 *
 * Coordinates are in pixels relative to the 1080×1920 canvas. (x, y) is the
 * top-left corner of the rectangle.
 */

export type RedZone = { x: number; y: number; width: number; height: number; label: string };
export type RedZoneSet = { name: string; zones: RedZone[] };

/**
 * TikTok vertical playback UI (as of 2026 TikTok app):
 *   - Top: status bar / "For You" pills / username header
 *   - Right rail: like/comment/share/save column (tall, narrow)
 *   - Bottom: caption text + share-sheet button + music ticker
 */
export const TIKTOK: RedZoneSet = {
  name: "tiktok",
  zones: [
    { x: 0,   y: 0,    width: 1080, height: 220,  label: "top:header" },
    { x: 920, y: 580,  width: 160,  height: 1100, label: "right:actions" },
    { x: 0,   y: 1620, width: 1080, height: 300,  label: "bottom:caption+share" },
  ],
};

/**
 * Instagram Reels — similar but slightly different button positions.
 */
export const INSTAGRAM_REELS: RedZoneSet = {
  name: "instagram_reels",
  zones: [
    { x: 0,   y: 0,    width: 1080, height: 200,  label: "top:status" },
    { x: 920, y: 540,  width: 160,  height: 1140, label: "right:actions" },
    { x: 0,   y: 1620, width: 1080, height: 300,  label: "bottom:caption+navbar" },
  ],
};

/**
 * YouTube Shorts.
 */
export const YOUTUBE_SHORTS: RedZoneSet = {
  name: "youtube_shorts",
  zones: [
    { x: 0,   y: 0,    width: 1080, height: 200,  label: "top:search+more" },
    { x: 920, y: 600,  width: 160,  height: 1120, label: "right:like+comment+share" },
    { x: 0,   y: 1640, width: 1080, height: 280,  label: "bottom:title+channel" },
  ],
};

/**
 * Multi-platform safe set — UNION of every above platform's red zones.
 * Anything outside these rectangles is safe on every platform.
 */
export const ALL_PLATFORMS: RedZoneSet = {
  name: "all_platforms",
  zones: [
    { x: 0,   y: 0,    width: 1080, height: 220,  label: "top:union" },
    { x: 920, y: 540,  width: 160,  height: 1180, label: "right:union" },
    { x: 0,   y: 1620, width: 1080, height: 300,  label: "bottom:union" },
  ],
};

export const REGISTRY: Record<string, RedZoneSet> = {
  tiktok: TIKTOK,
  instagram_reels: INSTAGRAM_REELS,
  youtube_shorts: YOUTUBE_SHORTS,
  all_platforms: ALL_PLATFORMS,
};
