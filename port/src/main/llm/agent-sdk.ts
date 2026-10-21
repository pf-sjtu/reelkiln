// PORT-NEW (docs/16): the minimal REAL Claude Agent SDK session path — the piece docs/15 §3.4
// deferred. It takes exactly what LlmRouteService.sessionRuntimeConfig() produces (route, model,
// child env incl. ANTHROPIC_BASE_URL + auth past sanitizedAgentEnv + model aliases + isolated
// CLAUDE_CONFIG_DIR) and hands it to the SDK's query(), like createLocalRuntime does (main/index.js
// L19964-20030). Deliberately minimal: one user prompt, optional tool use behind a strict
// canUseTool, no resume/hooks/MCP/session store/permission UI (still deferred, see docs/16 §5).
//
// The SDK is NOT a port dependency (the original pins @anthropic-ai/claude-agent-sdk ^0.3.281 and
// ships the per-platform native `claude` binary from @anthropic-ai/claude-agent-sdk-<plat>-<arch>).
// It is loaded at runtime from VIDEOCLAW_CLAUDE_AGENT_SDK (package dir, or a node_modules dir that
// contains @anthropic-ai/claude-agent-sdk), so tests and CI never need it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LlmProviderError } from "./errors";
import { redact, redactText, registerSecret } from "./logger";

export const CLAUDE_AGENT_SDK_ENV = "VIDEOCLAW_CLAUDE_AGENT_SDK";
export const CLAUDE_CODE_EXECUTABLE_ENV = "VIDEOCLAW_CLAUDE_CODE_EXECUTABLE";
export const CLAUDE_AGENT_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/** The slice of the SDK's surface this path uses (sdk.d.ts `query`). */
export interface AgentQuery extends AsyncIterable<Record<string, any>> { close?(): void; interrupt?(): Promise<void> }
export interface ClaudeAgentSdkLike { query(args: { prompt: string | AsyncIterable<unknown>; options?: Record<string, unknown> }): AgentQuery }
export interface LoadedSdk { sdk: ClaudeAgentSdkLike; packageDir: string; version: string }

/** Resolve the SDK package dir from a spec (package dir | node_modules dir | dir with node_modules). */
export function resolveSdkPackageDir(spec: string, exists: (p: string) => boolean = existsSync): string | undefined {
  const candidates = [spec, join(spec, "@anthropic-ai", "claude-agent-sdk"), join(spec, "node_modules", "@anthropic-ai", "claude-agent-sdk")];
  return candidates.find((d) => exists(join(d, "package.json")) && exists(join(d, "sdk.mjs")));
}

// esbuild would turn a bare import() into require() in the CJS bundle; the SDK is ESM-only.
const importEsm = new Function("u", "return import(u)") as (u: string) => Promise<any>;

export async function loadClaudeAgentSdk(spec: string | undefined = process.env[CLAUDE_AGENT_SDK_ENV]): Promise<LoadedSdk> {
  if (!spec?.trim()) throw new LlmProviderError("SDK_UNAVAILABLE", `Claude Agent SDK not configured: set ${CLAUDE_AGENT_SDK_ENV} to a directory containing ${CLAUDE_AGENT_SDK_PACKAGE} (npm i ${CLAUDE_AGENT_SDK_PACKAGE} in a sandbox dir).`);
  const packageDir = resolveSdkPackageDir(spec.trim());
  if (!packageDir) throw new LlmProviderError("SDK_UNAVAILABLE", `${CLAUDE_AGENT_SDK_PACKAGE} not found under ${spec}`);
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { name?: string; version?: string };
  if (pkg.name !== CLAUDE_AGENT_SDK_PACKAGE) throw new LlmProviderError("SDK_UNAVAILABLE", `${packageDir} is ${pkg.name}, not ${CLAUDE_AGENT_SDK_PACKAGE}`);
  const mod = await importEsm(pathToFileURL(join(packageDir, "sdk.mjs")).href);
  if (typeof mod?.query !== "function") throw new LlmProviderError("SDK_UNAVAILABLE", `${CLAUDE_AGENT_SDK_PACKAGE}@${pkg.version} has no query() export`);
  return { sdk: mod as ClaudeAgentSdkLike, packageDir, version: pkg.version ?? "unknown" };
}

/** Packaged branch of claudeCodeExecutable (L19505-19514): the per-platform native binary that
 *  sits next to the SDK package. Explicit override wins; undefined → let the SDK resolve it. */
export function claudeCodeExecutableFor(packageDir: string, o: { platform?: string; arch?: string; env?: NodeJS.ProcessEnv; exists?: (p: string) => boolean } = {}): string | undefined {
  const env = o.env ?? process.env;
  const exists = o.exists ?? existsSync;
  const override = env[CLAUDE_CODE_EXECUTABLE_ENV]?.trim();
  if (override) return override;
  const platform = o.platform ?? process.platform;
  const arch = o.arch ?? process.arch;
  const exe = platform === "win32" ? "claude.exe" : "claude";
  const scope = join(packageDir, "..");
  for (const pkg of [`claude-agent-sdk-${platform}-${arch}`, `claude-agent-sdk-${platform}-${arch}-musl`]) {
    const p = join(scope, pkg, exe);
    if (exists(p)) return p;
  }
  return undefined;
}

export interface RuntimeConfigLike { llmRoute: string; model: string | undefined; env: Record<string, string> }
export interface AgentTurnInput {
  runtime: RuntimeConfigLike;
  prompt: string;
  cwd: string;
  executable?: string;
  /** Tools the model may use; every call still goes through canUseTool. Default: none. */
  allowedTools?: string[];
  /** Allow-list predicate for tool calls (default: deny everything). */
  allowTool?: (name: string, input: Record<string, unknown>) => boolean;
  maxTurns?: number;
  timeoutMs?: number;
  includePartialMessages?: boolean;
  onMessage?: (m: Record<string, any>) => void;
}

/** The query() options — the createLocalRuntime option set (L19964-20030) reduced to what a single
 *  isolated turn needs. Pure so the SDK boundary can be asserted in tests. */
export function minimalAgentOptions(i: AgentTurnInput, extra: { abortController?: AbortController; stderr?: (s: string) => void; canUseTool?: unknown } = {}): Record<string, unknown> {
  const tools = i.allowedTools ?? [];
  return {
    cwd: i.cwd,
    model: i.runtime.model,
    env: { ...i.runtime.env },
    ...(i.executable ? { pathToClaudeCodeExecutable: i.executable } : {}),
    permissionMode: "default",
    includePartialMessages: i.includePartialMessages ?? true,
    // isolated: no user/project/local settings (the original loads only "project" settings with
    // attested hooks — not ported), no MCP servers except none, VideoClaw-style --strict-mcp-config
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    systemPrompt: { type: "preset", preset: "claude_code" },
    tools,
    allowedTools: [],
    maxTurns: i.maxTurns ?? (tools.length ? 4 : 1),
    persistSession: false,
    ...(extra.canUseTool ? { canUseTool: extra.canUseTool } : {}),
    ...(extra.abortController ? { abortController: extra.abortController } : {}),
    ...(extra.stderr ? { stderr: extra.stderr } : {}),
  };
}

export interface AgentTurnResult {
  ok: boolean;
  llmRoute: string;
  model: string | undefined;
  init?: { model?: string; apiKeySource?: string; claudeCodeVersion?: string; tools?: string[]; betas?: string[] };
  assistantText: string;
  /** tool_use blocks the model emitted (top-level agent only). */
  toolCalls: Array<{ id?: string; name: string; input: unknown }>;
  /** canUseTool consultations. NB Claude Code auto-allows commands it classifies as read-only
   *  (e.g. `echo`) WITHOUT consulting canUseTool (verified, docs/16 §4). */
  permissionChecks: Array<{ name: string; input: unknown; allowed: boolean }>;
  toolResults: Array<{ isError: boolean; text: string }>;
  streamEvents: number;
  result?: { subtype?: string; isError?: boolean; numTurns?: number; durationMs?: number; apiErrorStatus?: unknown; stopReason?: unknown; usage?: unknown; text?: string };
  error?: string;
  stderrTail?: string;
  ms: number;
}

const blockText = (c: unknown): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";

/** One real agent turn through the SDK. Never throws for agent-side failures (they land in
 *  `error`); everything returned is passed through the secret scrubber. */
export async function runAgentTurn(sdk: ClaudeAgentSdkLike, i: AgentTurnInput): Promise<AgentTurnResult> {
  const t0 = Date.now();
  const r: AgentTurnResult = { ok: false, llmRoute: i.runtime.llmRoute, model: i.runtime.model, assistantText: "", toolCalls: [], permissionChecks: [], toolResults: [], streamEvents: 0, ms: 0 };
  // whatever credential the child gets (provider key or gate-proxy token) must never be echoed back
  for (const k of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]) registerSecret(i.runtime.env[k]);
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), i.timeoutMs ?? 180_000);
  let stderr = "";
  const allowTool = i.allowTool ?? (() => false);
  const canUseTool = async (name: string, input: Record<string, unknown>) => {
    const allowed = (i.allowedTools ?? []).includes(name) && allowTool(name, input);
    r.permissionChecks.push({ name, input, allowed });
    return allowed ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: `tool ${name} is not allowed in this smoke session` };
  };
  const options = minimalAgentOptions(i, { abortController, canUseTool, stderr: (s) => { stderr = (stderr + s).slice(-4000); } });
  try {
    const q = sdk.query({ prompt: i.prompt, options });
    for await (const m of q) {
      i.onMessage?.(m);
      if (m.type === "stream_event") { r.streamEvents++; continue; }
      if (m.type === "system" && m.subtype === "init") {
        r.init = { model: m.model, apiKeySource: m.apiKeySource, claudeCodeVersion: m.claude_code_version, tools: m.tools, betas: m.betas };
      } else if (m.type === "assistant" && !m.parent_tool_use_id) {
        for (const b of m.message?.content ?? []) {
          if (b?.type === "text") r.assistantText += b.text;
          else if (b?.type === "tool_use") r.toolCalls.push({ id: b.id, name: b.name, input: b.input });
        }
      } else if (m.type === "user" && Array.isArray(m.message?.content)) {
        for (const b of m.message.content) if (b?.type === "tool_result") r.toolResults.push({ isError: !!b.is_error, text: blockText(b.content).slice(0, 2000) });
      } else if (m.type === "result") {
        r.result = { subtype: m.subtype, isError: m.is_error, numTurns: m.num_turns, durationMs: m.duration_ms, apiErrorStatus: m.api_error_status, stopReason: m.stop_reason, usage: m.usage ? { input_tokens: m.usage.input_tokens, output_tokens: m.usage.output_tokens, cache_read_input_tokens: m.usage.cache_read_input_tokens } : undefined, text: typeof m.result === "string" ? m.result.slice(0, 2000) : undefined };
      }
    }
    r.ok = !!r.result && r.result.subtype === "success" && !r.result.isError;
    if (!r.ok && !r.error) r.error = r.result ? `agent result ${r.result.subtype}${r.result.apiErrorStatus ? ` (api status ${r.result.apiErrorStatus})` : ""}` : "agent ended without a result message";
  } catch (e: any) {
    r.error = abortController.signal.aborted ? `timed out after ${i.timeoutMs ?? 180_000} ms` : String(e?.message ?? e);
  } finally {
    clearTimeout(timer);
  }
  if (stderr) r.stderrTail = stderr;
  r.ms = Date.now() - t0;
  const safe = redact(r) as AgentTurnResult;
  safe.assistantText = redactText(r.assistantText);
  return safe;
}
