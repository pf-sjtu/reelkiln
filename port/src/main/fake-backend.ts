// FAKE BACKEND — scaffold only. Modelled on the original renderer-side QA bridge
// (out/renderer/assets/qaFixtures-E0ox5qGv.js, `const fixtures = {…}` L1105-1919,
// installQaBridge L1920). Values below are copied from those fixtures (line cited) or
// from main-process fallbacks; nothing is invented. Every other channel is answered by
// `stubResult` = undefined and logged, clearly marked as NOT IMPLEMENTED.
import type { InvokeChannel } from "../shared/ipc-contract";
import { voiceDictationStatus } from "./platform/voice";

export type Push = (channel: string, ...args: unknown[]) => boolean;

/** qaBootstrapStatus (qaFixtures L48-69), verbatim. */
const qaBootstrapStatus = {
  ready: true,
  workspacePath: "/qa/workspace",
  shouldOffer: false,
  packaged: false,
  devMode: true,
  doctor: {
    ok: true,
    engine: "/qa/engine",
    workspace: "/qa/workspace",
    checks: {
      ffmpeg: { ok: true, detail: "ok" },
      ffprobe: { ok: true, detail: "ok" },
      node: { ok: true, detail: "ok" },
      "python venv": { ok: true, detail: "ok" },
      "yt-dlp": { ok: true, detail: "ok" },
      remotion: { ok: true, detail: "ok" },
      gateway: { ok: true, detail: "ok" },
      workspace: { ok: true, detail: "ok" },
      hooks: { ok: true, detail: "ok" },
      "taste packs": { ok: true, detail: "ok" },
    },
  },
};
/** clients (qaFixtures L337-340), verbatim. */
const clients = [
  { clientId: "personal", name: "Personal" },
  { clientId: "humeo", name: "Humeo", tenant: "humeo" },
];
/** Bootstrap step ids streamed by the QA bootstrapRun fixture. */
const BOOTSTRAP_STEPS = ["layout", "engine", "venv", "remotion", "hyperframes", "workspace", "env", "doctor"];

type Handler = (...args: any[]) => unknown;

export function createFakeBackend(push: Push, log: (m: string) => void) {
  const impl: Partial<Record<InvokeChannel, Handler>> = {
    "bootstrap:status": async () => qaBootstrapStatus, // L1132
    "bootstrap:run": async () => { // L1142-1159 (550ms per phase in QA; shortened)
      for (const step of BOOTSTRAP_STEPS) {
        push("bootstrap:progress", { step, status: "running" });
        await new Promise((r) => setTimeout(r, 60));
        push("bootstrap:progress", { step, status: "ok" });
      }
      return qaBootstrapStatus;
    },
    "client:list": async () => clients, // qaFixtures L1124
    "client:create": async (name: unknown) => ({ clientId: "qa-new", name }), // L1125
    "settings:get": async () => ({ gatewayUrl: "https://qa.invalid", llmRoute: "claude-code", llmRouteAcknowledgedAt: Date.now() - 864e5, telemetry: false }), // L1160-1166
    "app:restart": async () => true, // L1220-1224
    "engine:pendingToast": async () => null, // L1242
    "hfPreview:available": async () => ({ available: false }), // L1963
    "feedback:discard": async () => undefined, // L1123
    "engine:codexHandoffOffer": async () => ({ available: false, reason: "not-applicable" }), // L1965
    "job:get": async () => null, // L1250 (non-"s1" ids → null)
    // main-process fallback (original main/index.js L61340-61349)
    "app:update:state": async () => ({ status: "disabled", version: null, percent: null, message: "Updates are starting." }),
    // REAL port logic (platform layer, verbatim original algorithm): no helper on Windows.
    "media:voiceDictationStatus": async () => voiceDictationStatus({ helper: "", ffmpeg: "" }),
  };
  return {
    implemented: () => Object.keys(impl) as InvokeChannel[],
    invoke(channel: InvokeChannel, args: unknown[]): unknown {
      const h = impl[channel];
      if (h) return h(...args);
      log(`[fake-backend] NOT IMPLEMENTED ${channel}(${args.length} args) → undefined`);
      return undefined;
    },
  };
}
