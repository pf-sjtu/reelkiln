// PORT-NEW (docs/17 §3): structured-output emulation inside the agent gate proxy.
//
// Claude Code (2.1.305) asks for structured output on its tool-less side requests (e.g. the
// generate_session_title request) with Anthropic's `output_config.format = {type:"json_schema"}`
// (beta structured-outputs-2025-12-15). MiniMax's Anthropic-compatible endpoint answers 200 but
// IGNORES the field (free text, verified). With agentCompat.emulateStructuredOutputs the proxy
// rewrites such a request into ONE forced tool call carrying the schema (verified schema-valid on
// MiniMax) and rewrites the response back into what Claude Code expects from a structured-output
// reply: a single text block whose text is the JSON, stop_reason "end_turn".
//   - only requests WITHOUT client tools are rewritten (forcing a tool would hijack an agent turn);
//   - streamed (SSE) and non-streamed responses are both handled; thinking blocks pass through,
//     stray text blocks are dropped (block indices are renumbered so the client's accumulator stays
//     consistent); errors (non-200) pass through untouched.
import { STRUCTURED_TOOL_NAME } from "./structured-output";

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Returns the rewritten request body, or undefined when the request is not eligible. */
export function rewriteStructuredRequest(body: unknown): Json | undefined {
  if (!isObj(body) || !isObj(body.output_config) || !isObj(body.output_config.format)) return undefined;
  const f = body.output_config.format;
  if (f.type !== "json_schema" || !isObj(f.schema)) return undefined;
  if (Array.isArray(body.tools) && body.tools.length) return undefined;
  const { format: _f, ...restCfg } = body.output_config;
  const out: Json = { ...body, tools: [{ name: STRUCTURED_TOOL_NAME, description: "Return the final answer by calling this tool. Its arguments ARE the answer.", input_schema: f.schema }], tool_choice: { type: "tool", name: STRUCTURED_TOOL_NAME } };
  if (Object.keys(restCfg).length) out.output_config = restCfg; else delete out.output_config;
  return out;
}

/** Non-streamed Messages response → text-JSON response. */
export function rewriteStructuredMessage(msg: unknown): { msg: unknown; json?: string } {
  if (!isObj(msg) || !Array.isArray(msg.content)) return { msg };
  const tool = msg.content.find((b: any) => b?.type === "tool_use" && b?.name === STRUCTURED_TOOL_NAME);
  if (!tool) return { msg };
  const json = JSON.stringify(tool.input ?? {});
  const content = msg.content.filter((b: any) => b?.type === "thinking" || b?.type === "redacted_thinking");
  content.push({ type: "text", text: json });
  return { msg: { ...msg, content, stop_reason: msg.stop_reason === "tool_use" ? "end_turn" : msg.stop_reason }, json };
}

/** Incremental SSE rewriter for a streamed structured-output reply. */
export class StructuredSseRewriter {
  private buf = "";
  private readonly map = new Map<number, number>(); // upstream index → downstream index (kept blocks)
  private readonly kind = new Map<number, "tool" | "keep" | "drop">();
  private next = 0;
  /** The JSON text emitted for the structured tool (for stats / validation). */
  json = "";
  sawTool = false;

  push(chunk: string): string {
    this.buf += chunk.replace(/\r\n/g, "\n");
    let out = "";
    for (;;) {
      const i = this.buf.indexOf("\n\n");
      if (i < 0) break;
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      out += this.event(raw);
    }
    return out;
  }
  flush(): string { const rest = this.buf; this.buf = ""; return rest ? this.event(rest) : ""; }

  private emit(name: string | undefined, data: Json): string {
    return `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
  }
  private event(raw: string): string {
    const lines = raw.split("\n");
    const name = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
    const dataText = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    let data: Json;
    try { data = JSON.parse(dataText); } catch { return raw + "\n\n"; } // comments / [DONE] / non-JSON pass through
    if (!isObj(data)) return raw + "\n\n";
    switch (data.type) {
      case "content_block_start": {
        const up = Number(data.index);
        const b = data.content_block ?? {};
        if (b.type === "tool_use" && b.name === STRUCTURED_TOOL_NAME) {
          this.sawTool = true;
          this.kind.set(up, "tool"); this.map.set(up, this.next++);
          return this.emit(name, { type: "content_block_start", index: this.map.get(up), content_block: { type: "text", text: "" } });
        }
        if (b.type === "text") { this.kind.set(up, "drop"); return ""; }
        this.kind.set(up, "keep"); this.map.set(up, this.next++);
        return this.emit(name, { ...data, index: this.map.get(up) });
      }
      case "content_block_delta": {
        const up = Number(data.index);
        const k = this.kind.get(up);
        if (k === "drop") return "";
        if (k === "tool") {
          const t = data.delta?.type === "input_json_delta" ? String(data.delta.partial_json ?? "") : "";
          if (!t) return "";
          this.json += t;
          return this.emit(name, { type: "content_block_delta", index: this.map.get(up), delta: { type: "text_delta", text: t } });
        }
        return this.emit(name, { ...data, index: this.map.get(up) ?? up });
      }
      case "content_block_stop": {
        const up = Number(data.index);
        if (this.kind.get(up) === "drop") return "";
        return this.emit(name, { ...data, index: this.map.get(up) ?? up });
      }
      case "message_delta":
        if (this.sawTool && data.delta?.stop_reason === "tool_use") return this.emit(name, { ...data, delta: { ...data.delta, stop_reason: "end_turn" } });
        return raw + "\n\n";
      default:
        return raw + "\n\n";
    }
  }
}
