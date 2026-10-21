// PORT-NEW verification CLI (NOT part of the original app). Runs the *ported* main-process
// code paths without Electron so each Windows step can be verified in isolation:
//   node dist/cli/port-cli.cjs install-engine <bootstrapDir> <userDataDir>
//   node dist/cli/port-cli.cjs venv <engineDir>
//   node dist/cli/port-cli.cjs remotion <engineDir> [bootstrapDir]
//   node dist/cli/port-cli.cjs hyperframes <engineDir> [bootstrapDir]
//   node dist/cli/port-cli.cjs shims <engineDir>
//   node dist/cli/port-cli.cjs stage-workspace <engineDir> <workspaceDir>
//   node dist/cli/port-cli.cjs engine-contracts <engineDir>
//   node dist/cli/port-cli.cjs doctor <engineDir> <workspaceDir> [bootstrapDir]
//   node dist/cli/port-cli.cjs codex-handshake <codexExe>
//   node dist/cli/port-cli.cjs run-bash "<command>"
//   node dist/cli/port-cli.cjs minimax-config          (offline; key shown only as configured:true/false)
//   VIDEOCLAW_MINIMAX_LIVE=1 node dist/cli/port-cli.cjs minimax-ping   (ONE real request via the ported helper path)
// Every subcommand prints one JSON line `{ok, step, ...}` so results can be pasted back.
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BootstrapCore, createRunner, notPortedHooks, resolveBundledEngineSource, type BootstrapEnv } from "../main/engine/bootstrap";
import { ensureEngineCommandShims } from "../main/engine/command-shims";
import { writeWorkspacePartial } from "../main/engine/workspace";
import { validateEngineSessionContext } from "../main/engine/session-context.generated";
import { assertEngineMoneyCompatibility, inspectEngineMoneyCompatibility } from "../main/engine/money-compat.generated";
import { assertInstalledEngineProductionContract, inspectInstalledEngineProductionContract } from "../main/engine/production-contract.generated";
import { CodexAppServerClient } from "../main/codex/app-server-client";
import { runBash } from "../main/engine/run-bash";
import { bootstrapTool } from "../main/platform";
import { describeMiniMaxConfig, minimaxConfig } from "../main/llm/minimax";
import { anthropicMessages, resolveHelperCreds } from "../main/llm/llm-route";

const [, , cmd, a1, a2, a3] = process.argv;
const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

function core(o: { roots: string[]; userData?: string; workspace?: string }) {
  const env: BootstrapEnv = {
    platform: process.platform,
    userData: o.userData ?? mkdtempSync(join(tmpdir(), "vc-ud-")),
    workspaceRoot: o.workspace ?? mkdtempSync(join(tmpdir(), "vc-ws-")),
    bootstrapRoots: o.roots,
    packaged: false,
    inheritedPath: process.env.PATH ?? process.env.Path,
    bootstrapTool: (n) => bootstrapTool(n, { roots: o.roots, exists: existsSync }),
  };
  const hooks = notPortedHooks({
    resolveEngineSource: async () => resolveBundledEngineSource({ resourcesPath: "", env: { ...process.env, VIDEOCLAW_ENGINE_DIST: o.roots[0] }, appVersion: "0.0.40", packaged: false }),
    assertInstalledEngineProductionContract: (e) => assertInstalledEngineProductionContract(e),
    inspectProductionCompatible: (e) => inspectInstalledEngineProductionContract(e).compatible,
    validateEngineSessionContext: (e) => { validateEngineSessionContext(e); },
    assertEngineMoneyCompatibility: (e) => assertEngineMoneyCompatibility(e),
    ensureEngineCommandShims: (e) => ensureEngineCommandShims(e),
  });
  return new BootstrapCore(env, hooks, createRunner(), (p) => out({ progress: p }));
}

async function main() {
  const t0 = Date.now();
  try {
    switch (cmd) {
      case "install-engine": {
        const c = core({ roots: [a1], userData: a2 });
        const src = await (c as any).hooks.resolveEngineSource();
        const path = await c.installEngineDir(src.manifest, src.fetch, join(c.enginesRoot(), `engine-${src.manifest.version}`), (phase: string) => out({ phase }));
        return out({ ok: true, step: cmd, path, ms: Date.now() - t0 });
      }
      case "shims": ensureEngineCommandShims(a1); return out({ ok: true, step: cmd });
      case "engine-contracts": // PORT-NEW: the three activation-time engine/app contracts, run for real
        return out({ ok: true, step: cmd, sessionContext: validateEngineSessionContext(a1), production: inspectInstalledEngineProductionContract(a1), money: await inspectEngineMoneyCompatibility(a1) });
      case "stage-workspace": return out({ ok: true, step: cmd, ...writeWorkspacePartial(a1, a2) });
      case "venv": return out({ ok: true, step: cmd, detail: await core({ roots: a2 ? [a2] : [] }).ensureVenv(a1), ms: Date.now() - t0 });
      case "remotion": return out({ ok: true, step: cmd, detail: await core({ roots: a2 ? [a2] : [] }).ensureRemotion(a1), ms: Date.now() - t0 });
      case "hyperframes": return out({ ok: true, step: cmd, detail: await core({ roots: a2 ? [a2] : [] }).ensureHyperframes(a1), ms: Date.now() - t0 });
      case "doctor": {
        const c = core({ roots: a3 ? [a3] : [], workspace: a2 });
        const report = await c.runDoctor(a1, a2);
        return out({ ok: report.ok, step: cmd, failing: Object.entries(report.checks).filter(([, v]: any) => !v.ok).map(([k, v]: any) => ({ check: k, detail: v.detail, fix: v.fix })), ms: Date.now() - t0 });
      }
      case "codex-handshake": {
        const home = mkdtempSync(join(tmpdir(), "vc-codex-home-"));
        const client = new CodexAppServerClient({ executable: a1, env: { ...process.env, CODEX_HOME: home }, profileDir: home, appVersion: "0.0.40" });
        const warnings: string[] = [];
        client.onEvent((e) => { if (e.kind !== "notification") warnings.push(`${e.kind}: ${e.message}`); });
        try {
          await client.initialize();
          const account = await client.request("account/read", { refreshToken: false });
          return out({ ok: true, step: cmd, account, warnings, ms: Date.now() - t0 });
        } finally { client.close(); }
      }
      case "run-bash": {
        const r = await runBash({ command: a1 }, { cwd: process.cwd(), env: process.env });
        return out({ ok: !r.isError, step: cmd, output: r.output.slice(-2000) });
      }
      case "minimax-config": return out({ ok: true, step: cmd, minimax: describeMiniMaxConfig(minimaxConfig()) });
      case "minimax-ping": { // PORT-NEW live check; explicit opt-in so CI/tests never hit MiniMax
        if (process.env.VIDEOCLAW_MINIMAX_LIVE !== "1") return out({ ok: false, step: cmd, error: "set VIDEOCLAW_MINIMAX_LIVE=1 to make a real MiniMax request" });
        const creds = resolveHelperCreds({ llmRoute: "minimax", gatewayUrl: "" });
        if (!creds) return out({ ok: false, step: cmd, error: "MINIMAX_API_KEY is not set" });
        const r = await anthropicMessages(creds, { max_tokens: 256, messages: [{ role: "user", content: a1 || "Say hello in one short sentence." }] }, { timeoutMs: 60_000 });
        return out({ ok: r.ok, step: cmd, minimax: describeMiniMaxConfig(minimaxConfig()), result: r, ms: Date.now() - t0 });
      }
      default:
        out({ ok: false, error: `unknown subcommand ${cmd}` });
        process.exitCode = 2;
    }
  } catch (e: any) {
    out({ ok: false, step: cmd, error: String(e?.message ?? e).slice(0, 2000), stderr: typeof e?.stderr === "string" ? e.stderr.slice(-2000) : undefined, ms: Date.now() - t0 });
    process.exitCode = 1;
  }
}
void main();
void readFileSync;
