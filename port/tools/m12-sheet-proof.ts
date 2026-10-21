// docs/29 §8: the character-sheet plan + build through the PORT wiring, against the REAL installed engine
// (read-only, --engine) and the REAL local gateway shim + AgentGatewayProxy. The shim's MiniMax upstream is a
// fake that throws: this proof must never reach MiniMax (mint_image is refused before any model call).
// Usage: npx tsx tools/m12-sheet-proof.ts <outDir> --engine ENGINE_DIR --workspace WS
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { priceTable } from "../src/main/gateway/pricing";
import { minimaxConfig } from "../src/main/llm/minimax";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";
import { configureSheetEnv } from "../src/main/characters/sheet-env";
import { CharacterSheetBuilder } from "../src/main/characters/character-sheet.generated";
import { engineSessionEnv } from "../src/main/engine/session";
import { remainingChannels } from "../src/main/remaining-channels";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const outDir = resolve(process.argv[2] ?? "m12-sheet-proof"); mkdirSync(outDir, { recursive: true });
const ENGINE = resolve(arg("--engine") ?? ""); const WS = resolve(arg("--workspace") ?? "");
setLoggerForTests(createLogger({ level: "silent" }));
function png(w: number, h: number, rgb: [number, number, number]): Buffer { // a tiny valid PNG (no image library needed)
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
(async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-sheet-proof-"));
  let upstreamCalls = 0;
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig({ MINIMAX_API_KEY: "not-a-real-key-proof-only" })!, fetchImpl: (async () => { upstreamCalls++; throw new Error("MiniMax must not be called"); }) as any, monthUsd: 5, price: priceTable({ env: {}, catalog: null }), appVersion: "0.0.40-port.0" } as any);
  const url = await shim.start(); const { key } = shim.issueKey();
  const proxy = await AgentGatewayProxy.start(url, key);
  const deps = { currentEngine: () => ({ path: ENGINE, buildSha256: JSON.parse(readFileSync(join(ENGINE, "..", "..", "engine-current.json"), "utf8")).buildSha256 }), workspaceRoot: () => WS, enginePathEnv: (p: string) => `${join(p, "bin")}:${process.env.PATH}`, gatewaySessionConfig: () => ({ gatewayUrl: url }) };
  configureSheetEnv({ userData: () => root, isPackaged: () => false, currentEngine: () => ({ path: ENGINE }), engineSessionEnv: (k?: string, u?: string) => engineSessionEnv(deps as any, k, u) });
  const events: any[] = [];
  const builder: any = new (CharacterSheetBuilder as any)({}, (e: unknown) => events.push(e), {
    quoteGatewayBudget: (jobId: string, items: unknown) => proxy.quoteProject(jobId, items),
    gatewayCredentials: (scopeId: string, jobId: string, ceilingUsd: number) => proxy.credentialsForBudgetedTools(scopeId, new Set(["mint_image"]), 6, jobId, ceilingUsd),
    releaseGatewayCredentials: (scopeId: string) => proxy.revoke(scopeId),
  });
  const cwd = join(root, "project"); const dir = join(cwd, "characters", "pending", "ava"); mkdirSync(join(dir, "refs"), { recursive: true });
  for (const [i, c] of ([[200, 120, 90], [190, 110, 80], [210, 130, 100]] as [number, number, number][]).entries()) writeFileSync(join(dir, "refs", `photo-${i + 1}.png`), png(64, 64, c));
  const char = { slug: "ava", name: "Ava", dir };
  const ch = remainingChannels({ currentProjectMemoryScope: () => null, openLocalPath: async () => {}, assertGenerationAllowed: () => {}, absCwd: (c: string) => c, listSessions: () => [], push: () => {},
    sheets: { plan: () => builder.plan(char), build: async () => (existsSync(join(dir, "sheet.png")) ? false : builder.build(cwd, char)) } } as any);
  const plan: any = await ch["characters:sheetPlan"](cwd, "ava");
  const started = await ch["characters:sheetBuild"](cwd, "ava");
  for (let i = 0; i < 600 && !events.some((e) => e.state === null || e.state?.status === "error" || e.status === "error" || e.kind === "error" || e.state?.error); i++) await new Promise((r) => setTimeout(r, 200));
  const ledger = JSON.parse(readFileSync(join(root, "lg", "ledger.json"), "utf8"));
  const result = { plan, buildStarted: started, events: events.map((e) => JSON.stringify(e).slice(0, 400)), statesAfter: builder.statesFor(cwd), sheetExists: existsSync(join(dir, "sheet.png")),
    shim: { quotes: ledger.quotes?.length ?? 0, budgets: Object.keys(ledger.budgets ?? {}), refusals: ledger.refusals, sinks: ledger.sinks, entries: ledger.entries.length }, minimaxUpstreamCalls: upstreamCalls };
  writeFileSync(join(outDir, "sheet-proof.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1).slice(0, 4000));
  proxy.close(); await shim.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
