// PORT-NEW (docs/27 §4.3): structured-output emulation for the OpenAI **Responses** surface of the agent
// gate proxy (the Codex route). Codex 0.160.1 asks for structured output with `turn/start.outputSchema`,
// which it sends upstream as Responses `text.format = {type:"json_schema", schema}`. MiniMax's
// OpenAI-compatible /v1/responses answers 200 but IGNORES text.format (free text, verified 2026-10-21;
// docs/17 measured the same for Responses), while a forced function call returns schema-valid JSON
// (verified on the same endpoint, streamed). Same idea as structured-emulation.ts for the Anthropic route:
//   request : text.format json_schema → a function tool `structured_output` (parameters = schema);
//             tool_choice = that function when it is the only tool, else "required" (the agent may still
//             call its own tools first; its final step must then be the structured_output call)
//   response: the structured_output function_call item → an assistant `message` item whose single
//             output_text is the arguments JSON (streamed events renamed to response.output_text.*), so
//             Codex completes the turn with a final answer that IS the schema instance.
// Other function calls, reasoning items, errors and non-200 responses pass through untouched.
import { STRUCTURED_TOOL_NAME } from "./structured-output";

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export function rewriteResponsesStructuredRequest(body: unknown): Json | undefined {
  if (!isObj(body) || !isObj(body.text) || !isObj(body.text.format)) return undefined;
  const f = body.text.format;
  if (f.type !== "json_schema" || !isObj(f.schema)) return undefined;
  const { format: _f, ...restText } = body.text;
  const others = Array.isArray(body.tools) ? body.tools : [];
  const tool = { type: "function", name: STRUCTURED_TOOL_NAME, description: "Return the final answer by calling this tool. Its arguments ARE the answer; call it exactly once, as your last step.", parameters: f.schema, strict: f.strict === true };
  const out: Json = { ...body, tools: [...others, tool], tool_choice: others.length ? "required" : { type: "function", name: STRUCTURED_TOOL_NAME } };
  if (Object.keys(restText).length) out.text = restText; else delete out.text;
  return out;
}

const asMessage = (item: Json, text: string, status?: string): Json => ({ id: item.id, type: "message", status: status ?? item.status ?? "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] });
const isStructuredCall = (it: unknown): it is Json => isObj(it) && it.type === "function_call" && it.name === STRUCTURED_TOOL_NAME;

/** Non-streamed Responses object → the structured call becomes a message (output_text set). */
export function rewriteResponsesStructuredJson(resp: unknown): { resp: unknown; json?: string } {
  if (!isObj(resp) || !Array.isArray(resp.output)) return { resp };
  const call = resp.output.find(isStructuredCall);
  if (!call) return { resp };
  const json = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});
  return { resp: { ...resp, output: resp.output.map((it: unknown) => (isStructuredCall(it) ? asMessage(it, json) : it)), output_text: json }, json };
}

/** Incremental SSE rewriter (`event: …\ndata: {…}\n\n` frames). */
export class ResponsesStructuredSseRewriter {
  private buf = "";
  private readonly items = new Set<string>(); // item ids of the structured call
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
      out += this.frame(raw);
    }
    return out;
  }
  flush(): string { const rest = this.buf; this.buf = ""; return rest ? this.frame(rest) : ""; }
  private emit(type: string, data: Json): string { return `event: ${type}\ndata: ${JSON.stringify({ ...data, type })}\n\n`; }
  private frame(raw: string): string {
    const dataLine = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    let d: Json;
    try { d = JSON.parse(dataLine); } catch { return raw + "\n\n"; }
    if (!isObj(d) || typeof d.type !== "string") return raw + "\n\n";
    const seq = d.sequence_number;
    switch (d.type) {
      case "response.output_item.added":
      case "response.output_item.done": {
        if (!isStructuredCall(d.item)) break;
        this.items.add(d.item.id); this.sawTool = true;
        const done = d.type === "response.output_item.done";
        const text = done ? (typeof d.item.arguments === "string" ? d.item.arguments : this.json) : "";
        if (done) this.json = text;
        const item = asMessage(d.item, text, done ? "completed" : "in_progress");
        if (!done) {
          return this.emit(d.type, { sequence_number: seq, output_index: d.output_index, item: { ...item, content: [] } })
            + this.emit("response.content_part.added", { sequence_number: seq, item_id: d.item.id, output_index: d.output_index, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
        }
        return this.emit("response.content_part.done", { sequence_number: seq, item_id: d.item.id, output_index: d.output_index, content_index: 0, part: { type: "output_text", text, annotations: [] } })
          + this.emit(d.type, { sequence_number: seq, output_index: d.output_index, item });
      }
      case "response.function_call_arguments.delta":
        if (!this.items.has(d.item_id)) break;
        this.json += String(d.delta ?? "");
        return this.emit("response.output_text.delta", { sequence_number: seq, item_id: d.item_id, output_index: d.output_index, content_index: 0, delta: String(d.delta ?? ""), logprobs: [] });
      case "response.function_call_arguments.done":
        if (!this.items.has(d.item_id)) break;
        if (typeof d.arguments === "string") this.json = d.arguments;
        return this.emit("response.output_text.done", { sequence_number: seq, item_id: d.item_id, output_index: d.output_index, content_index: 0, text: this.json, logprobs: [] });
      case "response.completed":
      case "response.incomplete":
      case "response.done": {
        if (!isObj(d.response)) break;
        const r = rewriteResponsesStructuredJson(d.response);
        if (r.json !== undefined) { this.sawTool = true; this.json = r.json; return this.emit(d.type, { ...d, response: r.resp }); }
        break;
      }
    }
    return raw + "\n\n";
  }
}
