export interface Box { x: number; y: number; width: number; height: number }
export function center(r: Box): { x: number; y: number };
export function nativePlayButton(r: Box): { x: number; y: number };
export interface PlaybackSample { currentTime: number; paused: boolean; ended: boolean; readyState: number; error: number | null }
export function playbackVerdict(samples: PlaybackSample[]): { ok: boolean; why?: string; advancedS?: number; maxReadyState?: number };
export function redactEvidence(text: string, o?: { paths?: Record<string, string>; secrets?: string[] }): string;
export const S1_UI_STEPS: { id: string; what: string }[];
