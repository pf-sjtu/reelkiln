// PORT-NEW (docs/17): structured (JSON / JSON-Schema) output for helper calls, any protocol.
//
// Helper callers build an Anthropic-shaped body. A structured-output request may be expressed as
//   - Anthropic GA:      output_config.format = {type:"json_schema", schema}
//   - Anthropic beta:    output_format        = {type:"json_schema", schema}   (structured-outputs-2025-11-13)
//   - OpenAI style:      response_format      = {type:"json_schema", json_schema:{name, schema, strict?}} | {type:"json_object"}
// takeOutputFormat() normalises all three and strips them from the body; applyOutputFormat() then
// re-expresses the request for the target protocol according to the provider's
// `structuredOutput` mode:
//   native → the protocol's own field (anthropic output_config.format / chat response_format /
//            responses text.format) — use for servers that HONOR it (OpenAI, Anthropic, …)
//   tool   → a single forced function/tool call whose parameters are the schema; the response's
//            tool arguments are returned as the JSON text. Verified on MiniMax-M3.1-Flash (both the
//            Anthropic- and the OpenAI-compatible endpoint), which silently IGNORES every native
//            field (200 + free text) — docs/17 §2.
//   off    → the format is dropped (logged); the caller must parse/validate free text itself.
import { LlmProviderError } from "./errors";
import type { LlmProtocol } from "./provider-config";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export const STRUCTURED_OUTPUT_MODES = ["native", "tool", "off"] as const;
export type StructuredOutputMode = (typeof STRUCTURED_OUTPUT_MODES)[number];
/** Name of the synthetic tool used by "tool" mode (and recognised by extractStructuredToolOutput). */
export const STRUCTURED_TOOL_NAME = "structured_output";
const OBJECT_SCHEMA: Json = { type: "object" };

export interface OutputFormat {
  kind: "json_schema" | "json_object";
  name: string;
  schema?: Json;
  strict?: boolean;
  description?: string;
}

const bad = (msg: string, provider?: string) => new LlmProviderError("UNSUPPORTED_CONTENT", msg, { provider });
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function fromAnthropic(f: unknown, where: string, provider?: string): OutputFormat | undefined {
  if (f === undefined || f === null) return undefined;
  if (!isObj(f) || f.type !== "json_schema" || !isObj(f.schema)) throw bad(`${where}: expected {type:"json_schema", schema:{…}}`, provider);
  const name = typeof f.name === "string" && NAME_RE.test(f.name) ? f.name : "output";
  return { kind: "json_schema", name, schema: f.schema, ...(typeof f.description === "string" ? { description: f.description } : {}) };
}
function fromOpenAi(f: unknown, provider?: string): OutputFormat | undefined {
  if (f === undefined || f === null) return undefined;
  if (!isObj(f)) throw bad("response_format: must be an object", provider);
  if (f.type === "text") return undefined;
  if (f.type === "json_object") return { kind: "json_object", name: "output" };
  if (f.type === "json_schema" && isObj(f.json_schema) && isObj(f.json_schema.schema)) {
    const j = f.json_schema;
    return {
      kind: "json_schema", name: typeof j.name === "string" && NAME_RE.test(j.name) ? j.name : "output", schema: j.schema as Json,
      ...(typeof j.strict === "boolean" ? { strict: j.strict } : {}), ...(typeof j.description === "string" ? { description: j.description } : {}),
    };
  }
  throw bad(`response_format: unsupported type ${JSON.stringify(f.type)} (expected text | json_object | json_schema with json_schema.schema)`, provider);
}

/** Pulls the structured-output request out of a helper body (all three spellings). The returned
 *  body no longer carries it; other output_config fields (effort) are kept. At most one spelling. */
export function takeOutputFormat(body: Json, provider?: string): { body: Json; format?: OutputFormat } {
  const out: Json = { ...body };
  const found: OutputFormat[] = [];
  if (isObj(out.output_config) && "format" in out.output_config) {
    const { format, ...restCfg } = out.output_config;
    const f = fromAnthropic(format, "output_config.format", provider);
    if (f) found.push(f);
    if (Object.keys(restCfg).length) out.output_config = restCfg; else delete out.output_config;
  }
  if ("output_format" in out) { const f = fromAnthropic(out.output_format, "output_format", provider); if (f) found.push(f); delete out.output_format; }
  if ("response_format" in out) { const f = fromOpenAi(out.response_format, provider); if (f) found.push(f); delete out.response_format; }
  if (found.length > 1) throw bad("structured output requested more than once (output_config.format / output_format / response_format) — use one", provider);
  return { body: out, ...(found[0] ? { format: found[0] } : {}) };
}

function toolDescription(f: OutputFormat): string {
  return f.description ?? "Return the final answer by calling this tool. Its arguments ARE the answer; put nothing else in the reply.";
}

/** Re-expresses `format` on an already protocol-shaped body. Returns the dropped marker for "off". */
export function applyOutputFormat(protocol: LlmProtocol, mode: StructuredOutputMode, target: Json, f: OutputFormat | undefined): { body: Json; dropped?: string } {
  if (!f) return { body: target };
  const schema = f.schema ?? OBJECT_SCHEMA;
  const body: Json = { ...target };
  if (mode === "off") return { body, dropped: "structured_output" };
  if (mode === "native") {
    if (protocol === "anthropic-messages") {
      body.output_config = { ...(isObj(body.output_config) ? body.output_config : {}), format: { type: "json_schema", schema } };
    } else if (protocol === "openai-chat-completions") {
      body.response_format = f.kind === "json_object" ? { type: "json_object" } : { type: "json_schema", json_schema: { name: f.name, schema, ...(f.strict !== undefined ? { strict: f.strict } : {}), ...(f.description ? { description: f.description } : {}) } };
    } else {
      const text = isObj(body.text) ? body.text : {};
      body.text = { ...text, format: f.kind === "json_object" ? { type: "json_object" } : { type: "json_schema", name: f.name, schema, ...(f.strict !== undefined ? { strict: f.strict } : {}), ...(f.description ? { description: f.description } : {}) } };
    }
    return { body };
  }
  // tool mode: one extra tool, forced
  const tools = Array.isArray(body.tools) ? [...body.tools] : [];
  if (protocol === "anthropic-messages") {
    tools.push({ name: STRUCTURED_TOOL_NAME, description: toolDescription(f), input_schema: schema });
    body.tool_choice = { type: "tool", name: STRUCTURED_TOOL_NAME };
  } else if (protocol === "openai-chat-completions") {
    tools.push({ type: "function", function: { name: STRUCTURED_TOOL_NAME, description: toolDescription(f), parameters: schema } });
    body.tool_choice = { type: "function", function: { name: STRUCTURED_TOOL_NAME } };
  } else {
    tools.push({ type: "function", name: STRUCTURED_TOOL_NAME, description: toolDescription(f), parameters: schema });
    body.tool_choice = { type: "function", name: STRUCTURED_TOOL_NAME };
  }
  body.tools = tools;
  return { body };
}

function normaliseArgs(a: unknown): string {
  if (isObj(a) || Array.isArray(a)) return JSON.stringify(a);
  if (typeof a !== "string") return "";
  try { return JSON.stringify(JSON.parse(a)); } catch { return a; } // invalid JSON → raw (caller validates)
}

/** If the response carries a call of the synthetic structured-output tool, its arguments as JSON
 *  text; otherwise undefined. */
export function extractStructuredToolOutput(protocol: LlmProtocol, data: unknown): string | undefined {
  const d = (isObj(data) ? data : {}) as Record<string, any>;
  if (protocol === "anthropic-messages") {
    const b = Array.isArray(d.content) ? d.content.find((x: any) => x?.type === "tool_use" && x?.name === STRUCTURED_TOOL_NAME) : undefined;
    return b ? normaliseArgs(b.input ?? {}) : undefined;
  }
  if (protocol === "openai-chat-completions") {
    const calls = d.choices?.[0]?.message?.tool_calls;
    const c = Array.isArray(calls) ? calls.find((x: any) => x?.function?.name === STRUCTURED_TOOL_NAME) : undefined;
    return c ? normaliseArgs(c.function.arguments) : undefined;
  }
  const it = Array.isArray(d.output) ? d.output.find((x: any) => x?.type === "function_call" && x?.name === STRUCTURED_TOOL_NAME) : undefined;
  return it ? normaliseArgs(it.arguments) : undefined;
}

/** output_config.effort (Anthropic) → the OpenAI-protocol reasoning field; other output_config
 *  members have no OpenAI equivalent and are reported as dropped. */
export function mapOutputConfig(protocol: Exclude<LlmProtocol, "anthropic-messages">, oc: unknown): { fields: Json; dropped: string[] } {
  if (!isObj(oc)) return { fields: {}, dropped: oc === undefined ? [] : ["output_config"] };
  const fields: Json = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(oc)) {
    if (k === "effort" && typeof v === "string") {
      if (protocol === "openai-chat-completions") fields.reasoning_effort = v; else fields.reasoning = { effort: v };
    } else dropped.push(`output_config.${k}`);
  }
  return { fields, dropped };
}
