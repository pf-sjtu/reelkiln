// PORT-NEW glue (docs/26) for the verbatim FeedbackService slice: the module-scope collaborators the
// original resolves (recordMainLog L2440, mainLogSnapshot L2466, currentEngine L9200). Bound by real-backend.ts.
const ring: string[] = [];
let engine: () => { version?: string } | null = () => null;
export function configureFeedbackEnv(o: { currentEngine: () => { version?: string } | null }): void { engine = o.currentEngine; }
/** recordMainLog (L2440) — the bounded in-memory main-log ring a report carries. */
export function recordMainLog(kind: string, detail: string): void {
  ring.push(`${new Date().toISOString()} ${kind} ${String(detail).slice(0, 2000)}`);
  if (ring.length > 500) ring.splice(0, ring.length - 500);
}
export function mainLogSnapshot(): string[] { return [...ring]; }
export function currentEngine(): { version?: string } | null { try { return engine(); } catch { return null; } }
