// PORT-NEW (docs/15 §3.3): Anthropic Messages body → OpenAI Chat Completions / Responses body,
// INCLUDING non-text content. Helper callers always build an Anthropic-shaped body; before this
// module the openai-* adapters kept only text blocks, silently dropping images/documents.
//
// Mapping (each target follows its own public content schema):
//   Anthropic block                         chat.completions part                     responses input part
//   text                                    {type:"text",text}                        {type:"input_text",text}
//   image  source base64                    {type:"image_url",image_url:{url:data:}}  {type:"input_image",image_url:data:,detail:"auto"}
//   image  source url                       {type:"image_url",image_url:{url}}        {type:"input_image",image_url:url,detail:"auto"}
//   document source base64 (PDF)           {type:"file",file:{filename,file_data}}   {type:"input_file",filename,file_data}
//   document source url                     UNSUPPORTED_CONTENT (chat has no URL file) {type:"input_file",file_url}
//   document source text / content          text part(s)                              input_text part(s)
//   tool_use (assistant)                    assistant.tool_calls[]                     {type:"function_call",call_id,name,arguments}
//   tool_result (user)                      {role:"tool",tool_call_id,content}        {type:"function_call_output",call_id,output}
//   thinking / redacted_thinking            dropped (provider-internal, not portable)  dropped
//   image/document source "file" (Anthropic Files API id), server-tool blocks, unknown types → UNSUPPORTED_CONTENT
// Images inside a tool_result: the tool message gets the text, the images follow in a user message
// (chat tool messages are text-only; done the same way for responses for symmetry).
// Text-only messages stay plain strings (maximum compatibility with OpenAI-compatible servers).
import { LlmProviderError } from "./errors";

type Json = Record<string, unknown>;
type Block = Json & { type?: unknown };
export type OpenAiProtocol = "openai-chat-completions" | "openai-responses";

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const unsupported = (msg: string, provider?: string) => new LlmProviderError("UNSUPPORTED_CONTENT", msg, { provider });

/** Anthropic body fields with no OpenAI equivalent; removed (logged by the caller). */
export const ANTHROPIC_ONLY_FIELDS = ["top_k", "thinking", "metadata", "service_tier", "container", "mcp_servers", "context_management", "stream", "anthropic_beta", "betas"] as const;

function dataUrl(src: Json, what: string, provider?: string): string {
  const mt = typeof src.media_type === "string" ? src.media_type : "";
  const data = typeof src.data === "string" ? src.data : "";
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mt) || !data) throw unsupported(`${what}: base64 source needs media_type and data`, provider);
  return `data:${mt};base64,${data}`;
}

/** One Anthropic content block → zero or more neutral parts. */
type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string }
  | { kind: "file"; dataUrl?: string; fileUrl?: string; filename: string };

function blockParts(b: Block, where: string, provider?: string): Part[] {
  switch (b.type) {
    case "text": return [{ kind: "text", text: String(b.text ?? "") }];
    case "image": {
      const src = isObj(b.source) ? b.source : {};
      if (src.type === "base64") return [{ kind: "image", url: dataUrl(src, `${where} image`, provider) }];
      if (src.type === "url" && typeof src.url === "string") return [{ kind: "image", url: src.url }];
      throw unsupported(`${where}: image source "${String(src.type)}" cannot be sent to an OpenAI-protocol provider (only base64/url)`, provider);
    }
    case "document": {
      const src = isObj(b.source) ? b.source : {};
      const filename = typeof b.title === "string" && b.title.trim() ? b.title.trim() : "document.pdf";
      if (src.type === "base64") return [{ kind: "file", dataUrl: dataUrl(src, `${where} document`, provider), filename }];
      if (src.type === "url" && typeof src.url === "string") return [{ kind: "file", fileUrl: src.url, filename }];
      if (src.type === "text") return [{ kind: "text", text: String(src.data ?? "") }];
      if (src.type === "content") {
        const inner = Array.isArray(src.content) ? src.content : typeof src.content === "string" ? [{ type: "text", text: src.content }] : [];
        return inner.flatMap((x: unknown, i: number) => (isObj(x) ? blockParts(x, `${where}.source.content[${i}]`, provider) : []));
      }
      throw unsupported(`${where}: document source "${String(src.type)}" cannot be sent to an OpenAI-protocol provider`, provider);
    }
    case "thinking":
    case "redacted_thinking":
      return [];
    default:
      throw unsupported(`${where}: content block type "${String(b.type)}" is not supported by the OpenAI-protocol adapter`, provider);
  }
}

const asBlocks = (c: unknown): Block[] => (typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c.filter(isObj) : []);

function chatPart(p: Part, where: string, provider?: string): Json {
  if (p.kind === "text") return { type: "text", text: p.text };
  if (p.kind === "image") return { type: "image_url", image_url: { url: p.url } };
  if (!p.dataUrl) throw unsupported(`${where}: chat.completions cannot reference a document by URL — send it as base64, or use an openai-responses provider`, provider);
  return { type: "file", file: { filename: p.filename, file_data: p.dataUrl } };
}
function responsesPart(p: Part): Json {
  if (p.kind === "text") return { type: "input_text", text: p.text };
  if (p.kind === "image") return { type: "input_image", image_url: p.url, detail: "auto" };
  return p.dataUrl ? { type: "input_file", filename: p.filename, file_data: p.dataUrl } : { type: "input_file", file_url: p.fileUrl };
}
const onlyText = (parts: Part[]) => parts.every((p) => p.kind === "text");
const joinText = (parts: Part[]) => parts.map((p) => (p.kind === "text" ? p.text : "")).join("\n");

function toolResultText(b: Block, where: string, provider?: string): { text: string; media: Part[] } {
  const parts = asBlocks(b.content).flatMap((x, i) => blockParts(x, `${where}.content[${i}]`, provider));
  const text = joinText(parts.filter((p) => p.kind === "text"));
  return { text: b.is_error === true ? `[tool error] ${text}` : text, media: parts.filter((p) => p.kind !== "text") };
}

/** System prompt (string | text blocks) → plain text. Non-text system blocks are rejected. */
export function systemText(system: unknown, provider?: string): string {
  return asBlocks(system).map((b, i) => {
    if (b.type !== "text") throw unsupported(`system[${i}]: only text blocks are allowed in the system prompt`, provider);
    return String(b.text ?? "");
  }).join("\n");
}

/** Anthropic messages[] → OpenAI chat messages (without the system message). */
export function toChatMessages(messages: unknown, provider?: string): Json[] {
  const out: Json[] = [];
  (Array.isArray(messages) ? messages : []).forEach((m: unknown, mi: number) => {
    if (!isObj(m)) return;
    const role = m.role === "assistant" ? "assistant" : "user";
    const blocks = asBlocks(m.content);
    if (role === "assistant") {
      const toolCalls: Json[] = [];
      const parts: Part[] = [];
      blocks.forEach((b, bi) => {
        const where = `messages[${mi}].content[${bi}]`;
        if (b.type === "tool_use") toolCalls.push({ id: String(b.id ?? ""), type: "function", function: { name: String(b.name ?? ""), arguments: JSON.stringify(b.input ?? {}) } });
        else for (const p of blockParts(b, where, provider)) {
          if (p.kind !== "text") throw unsupported(`${where}: assistant messages can only carry text in chat.completions`, provider);
          parts.push(p);
        }
      });
      const text = joinText(parts);
      out.push({ role, content: text || (toolCalls.length ? null : ""), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      return;
    }
    const parts: Part[] = [];
    const deferredMedia: Part[] = [];
    blocks.forEach((b, bi) => {
      const where = `messages[${mi}].content[${bi}]`;
      if (b.type === "tool_result") {
        const r = toolResultText(b, where, provider);
        out.push({ role: "tool", tool_call_id: String(b.tool_use_id ?? ""), content: r.text });
        deferredMedia.push(...r.media);
      } else parts.push(...blockParts(b, where, provider));
    });
    const all = [...deferredMedia, ...parts];
    if (!all.length && blocks.some((b) => b.type === "tool_result")) return; // tool results only
    out.push({ role, content: onlyText(all) ? joinText(all) : all.map((p, i) => chatPart(p, `messages[${mi}] part ${i}`, provider)) });
  });
  return out;
}

/** Anthropic messages[] → OpenAI Responses `input` items. */
export function toResponsesInput(messages: unknown, provider?: string): Json[] {
  const out: Json[] = [];
  (Array.isArray(messages) ? messages : []).forEach((m: unknown, mi: number) => {
    if (!isObj(m)) return;
    const role = m.role === "assistant" ? "assistant" : "user";
    const blocks = asBlocks(m.content);
    const parts: Part[] = [];
    const deferredMedia: Part[] = [];
    const flush = () => {
      if (!parts.length) return;
      if (role === "assistant") {
        if (!onlyText(parts)) throw unsupported(`messages[${mi}]: assistant messages can only carry text`, provider);
        out.push({ role, content: joinText(parts) });
      } else out.push({ role, content: onlyText(parts) ? joinText(parts) : parts.map(responsesPart) });
      parts.length = 0;
    };
    blocks.forEach((b, bi) => {
      const where = `messages[${mi}].content[${bi}]`;
      if (b.type === "tool_use" && role === "assistant") {
        flush();
        out.push({ type: "function_call", call_id: String(b.id ?? ""), name: String(b.name ?? ""), arguments: JSON.stringify(b.input ?? {}) });
      } else if (b.type === "tool_result" && role === "user") {
        flush();
        const r = toolResultText(b, where, provider);
        out.push({ type: "function_call_output", call_id: String(b.tool_use_id ?? ""), output: r.text });
        deferredMedia.push(...r.media);
      } else parts.push(...blockParts(b, where, provider));
    });
    if (deferredMedia.length) parts.unshift(...deferredMedia);
    if (!parts.length && !blocks.length) parts.push({ kind: "text", text: "" });
    flush();
  });
  return out;
}

/** Anthropic tools[] → target tools; server tools (typed, no input_schema) are rejected. */
export function convertTools(tools: unknown, protocol: OpenAiProtocol, provider?: string): Json[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((t: unknown, i: number) => {
    if (!isObj(t) || typeof t.name !== "string" || (t.type !== undefined && t.type !== "custom") || !isObj(t.input_schema)) {
      throw unsupported(`tools[${i}]: only custom (client) tools with an input_schema can be translated`, provider);
    }
    const fn = { name: t.name, ...(typeof t.description === "string" ? { description: t.description } : {}), parameters: t.input_schema };
    return protocol === "openai-chat-completions" ? { type: "function", function: fn } : { type: "function", ...fn };
  });
}
export function convertToolChoice(tc: unknown, protocol: OpenAiProtocol): { tool_choice?: unknown; parallel_tool_calls?: boolean } {
  if (!isObj(tc)) return {};
  const par = tc.disable_parallel_tool_use === true ? { parallel_tool_calls: false } : {};
  switch (tc.type) {
    case "auto": return { tool_choice: "auto", ...par };
    case "any": return { tool_choice: "required", ...par };
    case "none": return { tool_choice: "none" };
    case "tool": return { tool_choice: protocol === "openai-chat-completions" ? { type: "function", function: { name: tc.name } } : { type: "function", name: tc.name }, ...par };
    default: return {};
  }
}
