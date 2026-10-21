// PORT-NEW glue: builds the main-process LLM runtime (settings store + route service + provider
// config hot reload) and the IPC handlers that expose it through the EXISTING contract:
//   settings:get              — original L61321 settings.get()
//   settings:set              — original L61680-61689 (rendererWritableSettingsPatch → patch →
//                               host.onLlmRouteChanged when the effective route changed);
//                               reconcileUsageSharing NOT PORTED
//   engine:llmRouteReadiness  — original L61608 host.llmRouteReadiness(sessionId)
// Electron-free so it is unit-testable; real-backend.ts calls it with app paths.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { InvokeChannel } from "../shared/ipc-contract";
import { PORT_IPC, type PortInvokeChannel } from "../shared/port-ipc";
import { getLogger, type Logger } from "./llm/logger";
import { reloadProviderRegistry, watchProvidersFile, type ProvidersFileWatcher } from "./llm/provider-registry";
import { bindRegistryReloads, LlmRouteService, type SessionMetaLike } from "./llm/route-service";
import { PROD_GATEWAY_URL, rendererWritableSettingsPatch, SettingsStore } from "./settings/settings-store";
import { getProviderRegistry } from "./llm/provider-registry";

export interface LlmRuntimeDeps {
  userData: string;
  env?: NodeJS.ProcessEnv;
  defaultGatewayUrl?: string;
  /** sessionId → meta (SessionRegistry). */
  sessionMeta?: (sessionId: string) => SessionMetaLike | undefined;
  /** AgentHost.onLlmRouteChanged — runtime teardown is NOT PORTED; default logs. */
  onLlmRouteChanged?: () => void;
  watch?: boolean;
  /** Install a SIGHUP → reload handler (POSIX only; ignored on win32). */
  sighup?: boolean;
  logger?: Logger;
}
export interface LlmRuntime {
  settings: SettingsStore;
  service: LlmRouteService;
  handlers: Partial<Record<InvokeChannel, (...a: any[]) => unknown>>;
  /** PORT-NEW channels (shared/port-ipc.ts), registered next to the original ones. */
  portHandlers: Partial<Record<PortInvokeChannel, (...a: any[]) => unknown>>;
  watcher: ProvidersFileWatcher | null;
  dispose(): void;
}

export function createLlmRuntime(d: LlmRuntimeDeps): LlmRuntime {
  const env = d.env ?? process.env;
  const log = (d.logger ?? getLogger()).child({ component: "llm-runtime" });
  const settings = new SettingsStore(join(d.userData, "settings.json"), d.defaultGatewayUrl ?? PROD_GATEWAY_URL);
  const service = new LlmRouteService({
    settings: () => settings.get() as any, // gateway key vault NOT PORTED → no gatewayKey
    env: () => env,
    profileDir: () => { const dir = join(d.userData, "engine-profile"); mkdirSync(dir, { recursive: true }); return dir; }, // L52521
    logger: d.logger,
  });
  const unbind = bindRegistryReloads(service, settings);
  const offRoute = service.onRouteChanged((route) => {
    if (d.onLlmRouteChanged) d.onLlmRouteChanged();
    else log.info("llm.route.on_changed", { route, note: "AgentHost.onLlmRouteChanged (runtime teardown) not ported" });
  });
  const watcher = d.watch === false ? null : watchProvidersFile({ env });
  const onHup = () => { reloadProviderRegistry({ env, reason: "SIGHUP" }); };
  const hup = d.sighup !== false && process.platform !== "win32";
  if (hup) process.on("SIGHUP", onHup);
  const reg = getProviderRegistry();
  log.info("llm.runtime.ready", { route: service.resolvedRoute(), providers: reg.names(), configError: reg.configError, watching: watcher?.file ?? null, parkedRoute: settings.parkedLlmRoute() });
  const handlers: LlmRuntime["handlers"] = {
    "settings:get": async () => settings.get(),
    "settings:set": async (patch: unknown) => {
      const safePatch = rendererWritableSettingsPatch(patch, getProviderRegistry());
      const previousRoute = service.resolvedRoute();
      settings.patch(safePatch);
      service.notifyIfRouteChanged(previousRoute);
      return settings.get();
    },
    "engine:llmRouteReadiness": async (sessionId: unknown) => service.llmRouteReadiness(typeof sessionId === "string" && sessionId ? d.sessionMeta?.(sessionId) : undefined),
  };
  const portHandlers: LlmRuntime["portHandlers"] = {
    [PORT_IPC.llmRoutes]: async () => service.listRoutes(),
  };
  return {
    settings, service, handlers, portHandlers, watcher,
    dispose: () => { unbind(); offRoute(); watcher?.close(); if (hup) process.off("SIGHUP", onHup); },
  };
}
