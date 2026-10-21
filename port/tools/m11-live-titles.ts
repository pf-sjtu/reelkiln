// PORT-NEW docs/28 M11 — ONE real MiniMax call through the local gateway shim: taste:titles on the gateway route
// (verbatim TasteTitleStore → resolveHelperCreds → {shim}/anthropic/v1/messages → MiniMax Anthropic API), charged
// to the shim ledger. Concurrency 1, a single request (withMiniMaxRetry backs off on 429/529). The MiniMax key is
// read from the environment by minimaxConfig() and registered as a secret (redacted from every log line); this
// script prints only titles, token counts and USD.
//   npx esbuild tools/m11-live-titles.ts --bundle --platform=node --format=cjs --outfile=/tmp/m11-live.cjs \
//     && node /tmp/m11-live.cjs --ledger-dir <userData>/local-gateway --out summary.json
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { CredentialStore } from "../src/main/account/local-reset-env";
import { AccountService } from "../src/main/account/account-service";
import { gatewayChannels } from "../src/main/gateway/gateway-channels";
import { SettingsStore } from "../src/main/settings/settings-store";
import { minimaxConfig } from "../src/main/llm/minimax";
import { registerSecret } from "../src/main/llm/logger";
import { tasteTitleKey } from "../src/main/taste/taste-titles.generated";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
(async () => {
  const p = minimaxConfig(process.env);
  if (!p) { console.error("MINIMAX_API_KEY not set"); process.exit(2); }
  registerSecret(p.apiKey);
  const ledgerDir = opt("--ledger-dir") ?? mkdtempSync(join(tmpdir(), "m11-ledger-"));
  const shim = new LocalGatewayShim({ dir: ledgerDir, provider: () => minimaxConfig(process.env), port: 0 });
  const url = await shim.start();
  const ud = mkdtempSync(join(tmpdir(), "m11-live-ud-"));
  const issued = shim.issueKey(); registerSecret(issued.key);
  try {
    const settings = new SettingsStore(join(ud, "settings.json"), url);
    const credentials = new CredentialStore({ file: join(ud, "credentials.dat"), packaged: false } as any);
    (credentials as any).setActiveKey(url, issued.key);
    const service = new AccountService({ settings, credentials: credentials as any, openedGatewayUrl: url, packaged: false, appVersion: "0.0.40", env: {}, push: () => {}, openExternal: async () => {} });
    const ch = gatewayChannels(service, { userData: ud });
    const snap: any = await ch["account:snapshot"]();
    settings.patch({ llmRoute: "gateway" });
    const before = shim.meter();
    const entries = [{ text: "字幕要粗体，背景不要加音乐", scope: "p1" }, { text: "旁白一律用我自己录的声音", scope: "p1" }];
    const t0 = Date.now();
    const titles: any = await ch["taste:titles"](entries);
    const ms = Date.now() - t0;
    const after = shim.meter();
    const led = shim.snapshot();
    const out = {
      at: new Date().toISOString(), shimUrl: url, accountStep: snap.step, legacyKeyOnly: snap.legacyKeyOnly, storedKeyIdMatches: snap.storedKeyId === issued.id,
      titles: entries.map((e) => ({ text: e.text, title: titles[tasteTitleKey(e.text, e.scope)] ?? null })), ms,
      ledgerEntry: led.entries.slice(-1).map((e: any) => ({ kind: e.kind, model: e.model, upstreamModel: e.upstreamModel, inputTokens: e.inputTokens, outputTokens: e.outputTokens, usd: e.usd, status: e.status, pricing: e.pricing }))[0] ?? null,
      meterBefore: { spend_this_month_usd: before.spend_this_month_usd, available_credit_usd: before.available_credit_usd },
      meterAfter: { spend_this_month_usd: after.spend_this_month_usd, available_credit_usd: after.available_credit_usd },
      cachedSecondCall: JSON.stringify(await ch["taste:titles"](entries)) === JSON.stringify(titles), entriesAfterSecondCall: shim.snapshot().entries.length - led.entries.length,
    };
    const o = opt("--out"); if (o) writeFileSync(o, JSON.stringify(out, null, 1));
    console.log(JSON.stringify(out, null, 1));
  } finally { shim.revokeKey(issued.id); await shim.close(); rmSync(ud, { recursive: true, force: true }); }
})().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
