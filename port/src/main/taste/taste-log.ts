// PORT-NEW: recordMainLog (original L60xxx main-log ring) stand-in for the verbatim taste module —
// the port's main log is console-based (index.ts log()); the line shape is kept.
export function recordMainLog(kind: string, detail: string): void {
  console.error(`[main-log] ${kind} ${detail}`);
}
