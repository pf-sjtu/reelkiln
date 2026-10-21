// docs/31 §5: reproduce the gateway-route SDK under-count. One REAL Claude Agent SDK turn (vendored native CLI)
// against the local gateway shim → MiniMax (concurrency 1). The turn makes several Bash calls; it is interrupted
// while an upstream call is streaming. Afterwards three meters are compared, per upstream call:
//   stream  — every message_start/message_delta the CLI streamed to the SDK (message id + usage)
//   sdk     — the result's cumulative modelUsage (what the port's gateway-route meter reads)
//   ledger  — the shim's per-call entries (MiniMax-reported usage, models.dev price)
// Usage: node m14-undercount-repro.cjs <outDir> [--interrupt-at-call N] [--hold-ms MS]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { minimaxConfig } from "../src/main/llm/minimax";
import { claudeSdkBaseEnv } from "../src/main/llm/llm-route";
import { loadClaudeAgentSdk, claudeCodeExecutableFor } from "../src/main/llm/agent-sdk";
import { createLogger, setLoggerForTests, registerSecret } from "../src/main/llm/logger";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const outDir = resolve(process.argv[2] ?? "m14-undercount"); mkdirSync(outDir, { recursive: true });
const INTERRUPT_AT = Number(arg("--interrupt-at-call", "3"));
const HOLD_MS = Number(arg("--hold-ms", "1500"));
const TAG = arg("--tag", "run");
setLoggerForTests(createLogger({ level: "silent" }));
const realKey = process.env.MINIMAX_API_KEY;
for (const k of Object.keys(process.env)) if (k.startsWith("__CURSOR_SANDBOX")) delete process.env[k];
if (!realKey) { console.error("MINIMAX_API_KEY missing"); process.exit(2); }
registerSecret(realKey);
const scrub = (s: string) => s.split(realKey).join("[MINIMAX_API_KEY]");

(async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m14-under-"));
  // diagnosis only: what each upstream request was (no headers are recorded: they carry the provider key)
  const t0Wall = Date.now();
  const upstreamRequests: any[] = [];
  const fetchImpl = (async (u: any, init: any) => {
    let b: any = {}; try { b = JSON.parse(String(init?.body ?? "{}")); } catch {}
    const sys = Array.isArray(b.system) ? b.system.map((x: any) => x?.text ?? "").join(" ") : String(b.system ?? "");
    const last = b.messages?.at?.(-1); const lastText = typeof last?.content === "string" ? last.content : Array.isArray(last?.content) ? last.content.map((c: any) => c?.text ?? c?.type).join(" ") : "";
    const row: any = { startMs: Date.now() - t0Wall, model: b.model, maxTokens: b.max_tokens, stream: b.stream, tools: Array.isArray(b.tools) ? b.tools.length : 0, messages: b.messages?.length, systemHead: sys.slice(0, 160), lastUserHead: String(lastText).slice(0, 200) };
    upstreamRequests.push(row);
    const r = await fetch(u, init); row.status = r.status; row.endMs = Date.now() - t0Wall; return r;
  }) as typeof fetch;
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig(process.env), fetchImpl });
  const url = await shim.start(); const { key } = shim.issueKey();
  const sdkDir = join(resolve(__dirname, ".."), "vendor", "claude-agent-sdk");
  const { sdk, packageDir, version } = await loadClaudeAgentSdk(process.env.VIDEOCLAW_CLAUDE_AGENT_SDK ?? sdkDir);
  const exe = claudeCodeExecutableFor(packageDir);
  const cwd = join(root, "ws"); mkdirSync(cwd, { recursive: true });
  const env = { ...claudeSdkBaseEnv(process.env), ANTHROPIC_BASE_URL: `${url}/anthropic`, ANTHROPIC_AUTH_TOKEN: key, CLAUDE_CONFIG_DIR: join(root, "profile"), ANTHROPIC_CUSTOM_HEADERS: `X-VideoClaw-Client-Job: m14-under-${TAG}` };
  if (Object.values(env).some((v) => String(v).includes(realKey))) throw new Error("key must not reach the CLI env");
  const calls: Array<{ id?: string; t: number; input?: number; output?: number; cacheRead?: number; stopped?: string }> = [];
  let current: (typeof calls)[number] | undefined;
  let interruptedAt: number | undefined; let interruptAck: string | undefined;
  const msgs: any[] = [];
  let endInput: () => void = () => {};
  const inputDone = new Promise<void>((r) => (endInput = r));
  async function* input() {
    yield { type: "user", message: { role: "user", content: "Run these four shell commands, strictly one Bash tool call each, one after another (never in parallel), then reply with a one-paragraph summary of all four outputs: 1) `echo one; sleep 1` 2) `echo two; sleep 1` 3) `ls -la /usr/bin | head -40` 4) `echo four`. Before each call, explain in two sentences what it does." }, parent_tool_use_id: null, session_id: "" };
    await inputDone;
  }
  const q: any = sdk.query({ prompt: input(), options: {
    cwd, model: "sonnet", env, ...(exe ? { pathToClaudeCodeExecutable: exe } : {}), permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true,
    includePartialMessages: true, settingSources: [], strictMcpConfig: true, mcpServers: {}, systemPrompt: { type: "preset", preset: "claude_code" },
    tools: ["Bash"], maxTurns: 12, persistSession: false, stderr: () => {},
  } });
  const t0 = t0Wall;
  let result: any;
  const hardStop = setTimeout(() => { try { q.interrupt?.(); } catch {} endInput(); }, 240_000);
  for await (const m of q) {
    if (m.type === "stream_event") {
      const ev = m.event;
      if (ev?.type === "message_start") {
        current = { id: ev.message?.id, t: Date.now() - t0, input: ev.message?.usage?.input_tokens, cacheRead: ev.message?.usage?.cache_read_input_tokens };
        calls.push(current);
        if (calls.length === INTERRUPT_AT && interruptedAt === undefined) {
          setTimeout(() => { interruptedAt = Date.now() - t0; Promise.resolve(q.interrupt()).then(() => (interruptAck = "ack"), (e: any) => (interruptAck = `error: ${e?.message ?? e}`)); }, HOLD_MS);
        }
      } else if (ev?.type === "message_delta" && current) { current.output = ev.usage?.output_tokens; current.stopped = ev.delta?.stop_reason; }
      continue;
    }
    msgs.push({ t: Date.now() - t0, type: m.type, subtype: m.subtype, id: m.message?.id, usage: m.message?.usage && { in: m.message.usage.input_tokens, out: m.message.usage.output_tokens } });
    if (m.type === "result") { result = m; endInput(); break; }
  }
  clearTimeout(hardStop);
  await new Promise((r) => setTimeout(r, 15_000)); // let the shim finish any upstream call the CLI walked away from
  const ledger = JSON.parse(JSON.stringify((shim as any).ledger));
  const entries = ledger.entries.filter((e: any) => e.kind === "model_call");
  const out = {
    tag: TAG, sdkVersion: version, interruptAtCall: INTERRUPT_AT, holdMs: HOLD_MS, interruptedAtMs: interruptedAt, interruptAck,
    streamedCalls: calls,
    resultMessage: result && { subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns, modelUsage: result.modelUsage, usage: result.usage, total_cost_usd: result.total_cost_usd },
    ledger: entries.map((e: any) => ({ at: e.at, model: e.model, inputTokens: e.inputTokens, outputTokens: e.outputTokens, cacheReadTokens: e.cacheReadTokens, usd: e.usd, status: e.status, clientJob: e.clientJob })),
    ledgerUsd: entries.reduce((a: number, e: any) => a + e.usd, 0),
    messages: msgs,
    upstreamRequests,
  };
  writeFileSync(join(outDir, `undercount-${TAG}.json`), scrub(JSON.stringify(out, null, 1)));
  const sum = (o: any, k: string) => Object.values(o ?? {}).reduce((a: number, u: any) => a + (Number(u?.[k]) || 0), 0);
  console.log(scrub(JSON.stringify({ tag: TAG, streamed: calls.length, ledgerCalls: entries.length, sdkIn: sum(result?.modelUsage, "inputTokens"), sdkOut: sum(result?.modelUsage, "outputTokens"), ledgerIn: entries.reduce((a: number, e: any) => a + e.inputTokens, 0), ledgerOut: entries.reduce((a: number, e: any) => a + e.outputTokens, 0), streamedOut: calls.reduce((a, c) => a + (c.output ?? 0), 0), subtype: result?.subtype, interruptedAt })));
  await shim.close(); process.exit(0);
})().catch((e) => { console.error(scrub(String(e?.stack ?? e))); process.exit(1); });
