// PORT-NEW: wire-protocol adapters for generic providers (docs/15 §3.2).
// Helper callers (proposeSessionTitle, Conductor judge, …) always build an ANTHROPIC-shaped body
// ({model, max_tokens, system?, messages}); for openai-* providers it is translated here, and every
// protocol's response is reduced to the concatenated text output. Content conversion: content-convert.ts.
import { LlmProviderError } from "./errors";
import { ANTHROPIC_ONLY_FIELDS, convertToolChoice, convertTools, systemText, toChatMessages, toResponsesInput } from "./content-convert";
import type { AuthConfig, LlmProtocol } from "./provider-config";
import type { ResolvedProvider } from "./provider-registry";

export const ANTHROPIC_VERSION = { "anthropic-version": "2023-06-01" } as const; // original L22342

export function endpointUrl(protocol: LlmProtocol, baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  switch (protocol) {
    case "anthropic-messages": return `${b}/v1/messages`;
    case "openai-chat-completions": return `${b}/chat/completions`;
    case "openai-responses": return `${b}/responses`;
  }
}

export function authHeaders(auth: AuthConfig, key: string): Record<string, string> {
  switch (auth.scheme) {
    case "x-api-key": return { "x-api-key": key };
    case "bearer": return { authorization: `Bearer ${key}` };
    case "header": return { [auth.header.toLowerCase()]: `${auth.prefix}${key}` };
  }
}

export function requestHeaders(p: Pick<ResolvedProvider, "protocol" | "auth" | "key" | "headers">): Record<string, string> {
  const extra = Object.fromEntries(Object.entries(p.headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ...extra, ...authHeaders(p.auth, p.key), "content-type": "application/json", ...(p.protocol === "anthropic-messages" ? ANTHROPIC_VERSION : {}) };
}

type AnthropicBlock = { type?: string; text?: string; [k: string]: unknown };

export interface BuildOptions {
  model?: string;
  defaultParams?: Record<string, unknown>;
  provider?: string;
  /** chat.completions only: newer OpenAI models reject `max_tokens` (default) and need `max_completion_tokens`. */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** Receives the names of Anthropic-only fields that were removed (for a debug log). */
  onDropped?: (fields: string[]) => void;
}

/** Anthropic-shaped helper body → protocol body. Defaults < body < pinned model. For the openai-*
 *  protocols every content block is converted (images, documents, tool calls — content-convert.ts);
 *  a block the target cannot represent throws UNSUPPORTED_CONTENT instead of being silently dropped. */
export function buildRequestBody(protocol: LlmProtocol, body: Record<string, unknown>, o: BuildOptions = {}): Record<string, unknown> {
  const defaults = o.defaultParams ?? {};
  const model = o.model ?? body.model;
  if (protocol === "anthropic-messages") return { ...defaults, ...body, ...(model !== undefined ? { model } : {}) };
  const { system, messages, max_tokens, model: _m, tools, tool_choice, stop_sequences, ...rest } = body as Record<string, unknown> & { max_tokens?: number };
  const dropped: string[] = [];
  for (const f of ANTHROPIC_ONLY_FIELDS) if (f in rest) { delete rest[f]; dropped.push(f); }
  const sys = systemText(system, o.provider);
  const convertedTools = convertTools(tools, protocol, o.provider);
  const choice = convertToolChoice(tool_choice, protocol);
  const extra: Record<string, unknown> = { ...(convertedTools ? { tools: convertedTools } : {}), ...choice };
  if (protocol === "openai-chat-completions") {
    if (Array.isArray(stop_sequences) && stop_sequences.length) extra.stop = stop_sequences.slice(0, 4);
    const msgs = toChatMessages(messages, o.provider);
    const field = o.maxTokensField ?? "max_tokens";
    if (dropped.length) o.onDropped?.(dropped);
    return { ...defaults, ...rest, ...extra, model, messages: sys ? [{ role: "system", content: sys }, ...msgs] : msgs, ...(max_tokens !== undefined ? { [field]: max_tokens } : {}) };
  }
  if (stop_sequences !== undefined) dropped.push("stop_sequences"); // the Responses API has no stop parameter
  if (dropped.length) o.onDropped?.(dropped);
  return { ...defaults, ...rest, ...extra, model, input: toResponsesInput(messages, o.provider), ...(sys ? { instructions: sys } : {}), ...(max_tokens !== undefined ? { max_output_tokens: max_tokens } : {}) };
}

/** Response JSON → text (thinking/reasoning blocks are ignored). Throws BAD_RESPONSE on a shape
 *  that has no recognisable text container. */
export function extractText(protocol: LlmProtocol, data: unknown, provider?: string): string {
  const d = (data ?? {}) as Record<string, any>;
  if (protocol === "anthropic-messages") {
    return Array.isArray(d.content) ? d.content.filter((b: AnthropicBlock) => b.type === "text").map((b: AnthropicBlock) => b.text ?? "").join(" ") : "";
  }
  if (protocol === "openai-chat-completions") {
    if (!Array.isArray(d.choices)) throw new LlmProviderError("BAD_RESPONSE", "chat completion response has no choices[]", { provider });
    const c = d.choices[0]?.message?.content;
    return typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("") : "";
  }
  if (typeof d.output_text === "string") return d.output_text;
  if (!Array.isArray(d.output)) throw new LlmProviderError("BAD_RESPONSE", "responses API response has no output[]", { provider });
  return d.output.filter((it: any) => it?.type === "message").flatMap((it: any) => (Array.isArray(it.content) ? it.content : []))
    .filter((p: any) => p?.type === "output_text").map((p: any) => String(p.text ?? "")).join("");
}

/** Env slice that points the Claude Agent SDK child at an anthropic-messages provider (sibling of
 *  the gateway branch, original L23306). Every model alias the Claude runtime may request is pinned.
 *  The isolated CLAUDE_CONFIG_DIR keeps a local claude.ai login from shadowing the endpoint. Gateway
 *  job headers (ANTHROPIC_CUSTOM_HEADERS) are never forwarded to a third party; only the provider's
 *  own `headers` (+ a custom auth header) are. */
export function claudeAgentEnv(p: ResolvedProvider, profileDir: string): Record<string, string> {
  if (p.protocol !== "anthropic-messages") {
    throw new LlmProviderError("UNSUPPORTED_PROTOCOL", `Provider "${p.name}" speaks ${p.protocol}; the Claude Agent SDK runtime needs an anthropic-messages provider (it can still serve helper calls).`, { provider: p.name });
  }
  const env: Record<string, string> = { ANTHROPIC_BASE_URL: p.baseUrl };
  const custom: string[] = Object.entries(p.headers).map(([k, v]) => `${k}: ${v}`);
  if (p.auth.scheme === "bearer") env.ANTHROPIC_AUTH_TOKEN = p.key;
  else if (p.auth.scheme === "x-api-key") env.ANTHROPIC_API_KEY = p.key;
  else custom.push(`${p.auth.header}: ${p.auth.prefix}${p.key}`);
  if (custom.length) env.ANTHROPIC_CUSTOM_HEADERS = custom.join("\n");
  Object.assign(env, {
    ANTHROPIC_MODEL: p.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: p.aliases.opus,
    ANTHROPIC_DEFAULT_SONNET_MODEL: p.aliases.sonnet,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: p.aliases.haiku,
    ANTHROPIC_SMALL_FAST_MODEL: p.aliases.smallFast,
    CLAUDE_CODE_SUBAGENT_MODEL: p.aliases.subagent,
  });
  if (p.agentEffort) env.CLAUDE_CODE_EFFORT_LEVEL = p.agentEffort;
  env.CLAUDE_CONFIG_DIR = profileDir;
  return env;
}
