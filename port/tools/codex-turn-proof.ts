// docs/27 §7: a REAL Codex-route agent turn through the PORT code path (codex-minimax backend + gate
// proxy + createCodexRuntime + verbatim codexEventToSdkMessages), on Linux, against MiniMax.
// Usage: npx tsx tools/codex-turn-proof.ts <outDir> [--effort high] [--structured]
// Prints/writes only redacted, key-free data (the key is registered as a secret and never logged).
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { redactText } from "../src/main/llm/logger";
import { createCodexRuntime, codexQuery } from "../src/main/codex/codex-runtime";
import { discoverMiniMaxCodexModels, ensureCodexProfile, resolveCodexExecutable, resolveMiniMaxCodexProvider, startCodexMiniMaxBackend } from "../src/main/codex/codex-minimax";
import { CodexAppServerClient } from "../src/main/codex/app-server-client";
import { codexChildEnv } from "../src/main/codex/codex-protocol.generated";

const outDir = resolve(process.argv[2] ?? "codex-proof-out");
const effort = process.argv.includes("--effort") ? process.argv[process.argv.indexOf("--effort") + 1] : "medium";
const structured = process.argv.includes("--structured");
mkdirSync(outDir, { recursive: true });
const p = resolveMiniMaxCodexProvider();
if (!p) { console.error("MINIMAX_API_KEY is not set"); process.exit(2); }
const exe = resolveCodexExecutable({ appRoot: resolve(__dirname, "..") });
const work = mkdtempSync(join(tmpdir(), "vc-codex-proof-"));
const cwd = join(work, "workspace"); mkdirSync(cwd);
writeFileSync(join(cwd, "hello.txt"), "The secret fruit is mango.\n");
const profileDir = join(work, "codex-profile");
ensureCodexProfile(profileDir, p.model);
const log: any[] = [];
const t0 = Date.now();
(async () => {
  // 1) account/read through the real binary with the app-owned profile (codexStatus path)
  const statusClient = new CodexAppServerClient({ executable: exe, profileDir, env: codexChildEnv(undefined, {}, profileDir), requestTimeoutMs: 15e3 });
  const account = await statusClient.accountStatus();
  statusClient.close();
  // 2) MiniMax model discovery (codexModels path)
  const models = await discoverMiniMaxCodexModels(p);
  // 3) one real turn: text + a provider command (tool round-trip)
  const backend = await startCodexMiniMaxBackend(p);
  const approvals: any[] = [];
  const rt = createCodexRuntime({
    sessionId: "proof", cwd, model: p.model, reasoningEffort: effort, permissionMode: "auto", provider: "chatgpt", backend,
    sessionContext: { append: "" }, engineEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, profileDir, executable: exe,
    canUseTool: async (tool, input) => { approvals.push({ tool, input }); return { behavior: "deny" }; },
    ...(structured ? { outputSchema: { type: "object", properties: { fruit: { type: "string" } }, required: ["fruit"], additionalProperties: false } } : {}),
    onWarning: (m) => log.push({ t: Date.now() - t0, warning: redactText(m).slice(0, 300) }),
  });
  const prompt = (async function* () {
    yield { type: "user", uuid: "proof-turn-1", message: { role: "user", content: [{ type: "text", text: structured ? "Read hello.txt in the current directory with a shell command and report the secret fruit." : "Use a shell command to read hello.txt in the current directory, then tell me the secret fruit in one sentence." }] } };
    await new Promise((r) => setTimeout(r, 600_000));
  })();
  const msgs: any[] = [];
  try {
    for await (const m of codexQuery(rt, prompt)) { msgs.push(m); log.push({ t: Date.now() - t0, type: m.type, subtype: m.subtype, content: redactText(JSON.stringify(m.message?.content ?? m.result ?? m.model ?? "")).slice(0, 400) }); }
  } catch (e: any) { log.push({ t: Date.now() - t0, error: redactText(String(e?.message ?? e)) }); }
  const stats = backend.proxy.stats();
  await backend.close();
  const toolUses = msgs.filter((m) => m.type === "assistant").flatMap((m) => m.message.content).filter((b: any) => b.type === "tool_use");
  const toolResults = msgs.filter((m) => m.type === "user").flatMap((m) => m.message.content).filter((b: any) => b.type === "tool_result");
  const finalText = msgs.filter((m) => m.type === "assistant").flatMap((m) => m.message.content).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const result = msgs.find((m) => m.type === "result");
  const summary = {
    at: new Date().toISOString(), codexExecutable: exe.replace(resolve(__dirname, ".."), "<port>"), effort, structured,
    account, models: models.map((m) => ({ id: m.id, isDefault: m.isDefault, efforts: m.supportedReasoningEfforts.map((e) => e.effort) })),
    init: msgs.find((m) => m.type === "system"),
    toolUses: toolUses.map((b: any) => ({ name: b.name, input: b.input })), toolResults: toolResults.map((b: any) => ({ is_error: !!b.is_error, content: redactText(String(typeof b.content === "string" ? b.content : JSON.stringify(b.content))).slice(0, 200) })),
    finalText: redactText(finalText).slice(0, 600), result: result ? { subtype: result.subtype, is_error: result.is_error, session_id: result.session_id } : null,
    approvalsAsked: approvals.length, gateProxy: stats, durationMs: Date.now() - t0,
    pass: !!result && result.subtype === "success" && toolUses.length > 0 && toolResults.length > 0 && /mango/i.test(finalText) && stats.rejected === 0 && stats.maxInflight <= 1,
  };
  writeFileSync(join(outDir, structured ? "codex-turn-structured.json" : `codex-turn-${effort}.json`), JSON.stringify({ summary, log }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.pass ? 0 : 1);
})().catch((e) => { console.error(redactText(String(e?.stack ?? e))); process.exit(1); });
