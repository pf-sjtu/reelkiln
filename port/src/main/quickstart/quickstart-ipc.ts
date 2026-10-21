// docs/24 (C1): quickstart:catalog served by the ORIGINAL QuickstartCatalogStore (verbatim,
// quickstart-catalog.generated.ts). Electron-free so it is unit-tested; real-backend.ts wires it.
//   store construction  — original L61015-61041: candidate roots (VIDEOCLAW_QUICKSTART_FIXTURE_DIR in
//                         dev, resourcesPath/quickstarts, appPath/resources/quickstarts,
//                         appPath/apps/desktop/resources/quickstarts), cache userData/quickstarts/
//                         last-known-good, exposePreview → mediaCapabilities.grant(path,"quickstart") →
//                         vcmedia://local<path>, remote {settings, trustedKeys, onEvent}.
//   quickstart:catalog  — original L61215-61250 (cached → warm + background refresh → push
//                         quickstart:catalogChanged when the view differs; cold → refresh()).
// PORT differences (documented, docs/24):
//   - PORT-NEW dev candidate root: <port>/../app/resources/quickstarts (the shipped bundled catalog in
//     this repo; the original dev tree keeps it at apps/desktop/resources/quickstarts). Packaged builds
//     ship it at resources/quickstarts (tools/packaging-config.mjs) = the original's own root.
//   - The signed remote channel needs a gateway key; the port has no account service, so
//     remote.settings() reports no key → remoteTarget() is null (the original's no-key branch) and the
//     bundled catalog is served. trustedKeys is therefore never consulted ({} here).
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beginQuickstartLatency, QuickstartCatalogStore, sameQuickstartCatalogView } from "./quickstart-catalog.generated";

export interface QuickstartDeps {
  packaged: boolean;
  env: NodeJS.ProcessEnv;
  resourcesPath: string;
  appPath: string;
  userData: string;
  grant: (path: string, source: string) => boolean;
  gatewayUrl?: () => string | undefined;
  push: (channel: string, ...a: unknown[]) => unknown;
  log?: (kind: string, detail: string) => void;
}

export function quickstartCandidateRoots(d: Pick<QuickstartDeps, "packaged" | "env" | "resourcesPath" | "appPath">): string[] {
  return [
    ...(!d.packaged && d.env.VIDEOCLAW_QUICKSTART_FIXTURE_DIR ? [resolve(d.env.VIDEOCLAW_QUICKSTART_FIXTURE_DIR)] : []),
    join(d.resourcesPath ?? "", "quickstarts"),
    join(d.appPath, "resources", "quickstarts"),
    join(d.appPath, "apps", "desktop", "resources", "quickstarts"),
    ...(!d.packaged ? [resolve(d.appPath, "..", "app", "resources", "quickstarts")] : []), // PORT-NEW dev root
  ];
}

export function createQuickstartCatalog(d: QuickstartDeps): { store: any; handlers: Record<string, (...a: any[]) => unknown> } {
  const store: any = new QuickstartCatalogStore(
    quickstartCandidateRoots(d),
    join(d.userData, "quickstarts", "last-known-good"),
    (path: string) => {
      if (!d.grant(path, "quickstart")) throw new Error("Quickstart preview could not be exposed safely.");
      return `vcmedia://local${pathToFileURL(path).pathname}`;
    },
    {
      settings: () => ({ gatewayUrl: d.gatewayUrl?.() ?? "", gatewayKey: undefined }),
      trustedKeys: {},
      onEvent: (kind: string, detail: string) => d.log?.(kind, detail),
    },
  );
  let notifyingCatalogRefresh: Promise<unknown> | undefined;
  const catalog = () => { // L61215
    const served = beginQuickstartLatency("catalog_serve");
    let cached: any;
    try {
      cached = store.cached();
    } catch (error) {
      served({ ok: false });
      throw error;
    }
    if (!cached) {
      const refreshing2 = store.refresh();
      void refreshing2.then((fresh: any) => served({ ok: true, path: "cold", source: fresh.source }), () => served({ ok: false, path: "cold" }));
      return refreshing2;
    }
    const refreshing = store.refresh();
    if (refreshing !== notifyingCatalogRefresh) {
      notifyingCatalogRefresh = refreshing;
      void refreshing
        .then((fresh: any) => { if (!sameQuickstartCatalogView(cached, fresh)) d.push("quickstart:catalogChanged", fresh); }, () => {})
        .finally(() => { if (notifyingCatalogRefresh === refreshing) notifyingCatalogRefresh = undefined; });
    }
    served({ ok: true, path: "warm", source: cached.source });
    return cached;
  };
  return { store, handlers: { "quickstart:catalog": catalog } };
}
