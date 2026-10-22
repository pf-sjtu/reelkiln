// PORT-NEW docs/23 M5: pure helpers of the UI-e2e driver (unit-tested in test/ui-e2e.test.ts).

/** Center of a DOMRect-like box (CSS px, viewport coordinates = Input.dispatchMouseEvent coordinates). */
export const center = (r) => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

/** Chromium's native <video controls> panel: the play/pause button sits at the left of the bottom bar
 *  (≈24 px from the left edge, ≈50 px above the bottom on a ≥ 200 px tall player — measured on Electron 42). */
export function nativePlayButton(r) {
  // docs/36: a 144 px-high player (Windows S1 layout) still has the button row above the timeline; 20 px from the
  // bottom hits the timeline (seek, no play). Below 120 px Chromium folds the controls into one row.
  return { x: Math.round(r.x + 24), y: Math.round(r.y + r.height - (r.height >= 200 ? 50 : r.height >= 120 ? 48 : 20)) };
}

/** Playback is proven when the element is unpaused, fully buffered and the clock advanced over time. */
export function playbackVerdict(samples) {
  if (!samples.length) return { ok: false, why: "no samples" };
  const first = samples[0], last = samples[samples.length - 1];
  const advanced = last.currentTime - first.currentTime;
  const ok = samples.every((s) => !s.paused || s.ended) && Math.max(...samples.map((s) => s.readyState)) === 4 && advanced > 0.5 && !samples.some((s) => s.error);
  return { ok, advancedS: +advanced.toFixed(3), maxReadyState: Math.max(...samples.map((s) => s.readyState)) };
}

/** Redact secrets + run-specific absolute paths from evidence text. Keys are never logged by the driver;
 *  this is a belt-and-braces scrub for anything copied out of the app/page. */
export function redactEvidence(text, { paths = {}, secrets = [] } = {}) {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("<REDACTED>");
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, "<REDACTED>");
  for (const [p, label] of Object.entries(paths).sort((a, b) => b[0].length - a[0].length)) if (p) out = out.split(p).join(label);
  return out;
}

/** Ordered S1 UI step list — what the driver must really do through the original renderer. */
export const S1_UI_STEPS = [
  { id: "home", what: "boot to the original home (route picker preset: minimax is PORT-NEW, not in the original picker)" },
  { id: "project", what: "Projects + → Create project dialog → type name → Create" },
  { id: "video", what: "hover project → 'New video in <project>' button" },
  { id: "attach", what: "OS drag-and-drop of 4 files (Input.dispatchDragEvent) onto the composer" },
  { id: "brief", what: "click composer textarea → Input.insertText(brief) → click Send" },
  { id: "stream", what: "agent turn streams into the original transcript (MiniMax, concurrency 1)" },
  { id: "play", what: "click the native play control of the Output panel <video>; currentTime advances, readyState 4" },
  { id: "approve", what: "click 'Approve V1' → '✅ V1 approved' + 'This video is finalized'" },
  { id: "export", what: "click the Output panel Download button → file:saveItemAs (save dialog answered by env preset)" },
];

/** docs/24 (A): does the agent's text after an answered question card say the QUESTION was refused?
 *  Targets the refusal the SDK hands back on a deny ("The user declined this step." / "Denied by user")
 *  and the agent's paraphrases of it about the question/step itself — NOT any "declin…": on a multiSelect
 *  card the agent legitimately says the user "declined" the options left unticked, and qcardQ1's taste
 *  file quotes its own heading "ANTI-COMMITMENTS (declined proposals — do not re-raise)". */
export const DECLINE_RE = /declined this step|denied by user|\b(?:user|you)\s+(?:has\s+|have\s+)?(?:declined|denied|rejected|dismissed|skipped)\s+(?:the|this|my|your)\s+(?:question|step|card|prompt)|\b(?:question|AskUserQuestion|step)\s+was\s+(?:declined|denied|rejected|dismissed)|拒绝了(?:这个|该)?(?:问题|提问)|没有回答|未回答/i;
export function answerDeclined(texts) { return texts.some((t) => DECLINE_RE.test(String(t))); }
