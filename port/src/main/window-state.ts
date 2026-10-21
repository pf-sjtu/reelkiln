// docs/34 M17 T1: the window:state push (createWindow L60574-60580). fullscreenStateForWindow (L55783-55791) and
// liveWindow (L55732-55741) are transcribed verbatim; wireWindowState attaches the same three listeners.
interface WindowLike {
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  webContents: { isDestroyed(): boolean; on(event: "did-finish-load", cb: () => void): unknown };
  on(event: "enter-full-screen" | "leave-full-screen", cb: () => void): unknown;
}
function isDestroyedObjectError(error: unknown): boolean { // L55729
  return /object has been destroyed/i.test(error instanceof Error ? error.message : String(error));
}
export function liveWindow<W extends WindowLike>(currentWindow: () => W | null | undefined): W | null { // L55732
  const window = currentWindow();
  if (!window) return null;
  try {
    return window.isDestroyed() || window.webContents.isDestroyed() ? null : window;
  } catch (error) {
    if (isDestroyedObjectError(error)) return null;
    throw error;
  }
}
export function fullscreenStateForWindow<W extends WindowLike>(window: W, currentWindow: () => W | null | undefined): boolean | null { // L55783
  if (currentWindow() !== window || liveWindow(() => window) !== window) return null;
  try {
    return window.isFullScreen();
  } catch (error) {
    if (isDestroyedObjectError(error)) return null;
    throw error;
  }
}
/** L60574-60580: pushWindowState on enter/leave-full-screen and every did-finish-load. */
export function wireWindowState<W extends WindowLike>(created: W, currentWindow: () => W | null | undefined, sendToRenderer: (channel: "window:state", payload: { fullscreen: boolean }) => unknown): () => void {
  const pushWindowState = () => {
    const fullscreen = fullscreenStateForWindow(created, currentWindow);
    if (fullscreen === null) return;
    sendToRenderer("window:state", { fullscreen });
  };
  created.on("enter-full-screen", pushWindowState);
  created.on("leave-full-screen", pushWindowState);
  created.webContents.on("did-finish-load", pushWindowState);
  return pushWindowState;
}
