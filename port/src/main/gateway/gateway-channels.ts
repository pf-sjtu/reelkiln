// PORT-NEW glue (docs/28): the channels served by the account service + local gateway shim, assembled for
// real-backend.ts (and driven directly by test/account-gateway.test.ts).
//   account:* / gateway:* / settings:saveGatewayKey / settings:switchGateway → AccountService.handlers()
//   taste:titles L61854 → TasteTitleStore.getTitles(entries, paidWorkBlocked() ? null : resolveHelperCreds(activeSettings()))
//     (verbatim taste-titles.generated.ts): helper creds exist only on llmRoute "gateway" with a key, i.e. the
//     helper call goes to {gateway}/anthropic/v1/messages — with the shim, MiniMax, metered in the local ledger.
import { join } from "node:path";
import type { AccountService } from "../account/account-service";
import { resolveHelperCreds, TasteTitleStore } from "../taste/taste-titles.generated";

type Handler = (...a: any[]) => unknown;
export function gatewayChannels(service: AccountService, o: { userData: string; fetchImpl?: typeof fetch }): Record<string, Handler> {
  const tasteTitles = new TasteTitleStore(join(o.userData, "taste-titles.json"), o.fetchImpl);
  return {
    ...service.handlers(),
    "taste:titles": (entries: unknown) => tasteTitles.getTitles(Array.isArray(entries) ? entries : [], service.paidWorkBlocked() ? null : resolveHelperCreds(service.activeSettings())),
  };
}
