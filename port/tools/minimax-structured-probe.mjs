#!/usr/bin/env node
// PORT-NEW (docs/17 §2): raw MiniMax structured-output probes (no port code involved) — the
// evidence behind the MiniMax preset's structuredOutput:"tool" / emulateStructuredOutputs.
// Strictly sequential (concurrency 1, the key is shared). The key is read from MINIMAX_API_KEY and
// never printed (outputs are scrubbed). Opt-in: VIDEOCLAW_LLM_LIVE=1.
// Usage: VIDEOCLAW_LLM_LIVE=1 node tools/minimax-structured-probe.mjs [substring filter …]
if (process.env.VIDEOCLAW_LLM_LIVE !== "1") { console.error("set VIDEOCLAW_LLM_LIVE=1 (makes real MiniMax requests)"); process.exit(2); }
const KEY = process.env.MINIMAX_API_KEY; if (!KEY) { console.error("MINIMAX_API_KEY not set"); process.exit(2); }
const MODEL = "MiniMax-M3.1-Flash";
const PROMPT = "A short video shows a cat riding a surfboard at sunset. Propose a title and three tags for it.";
const schema = { type: "object", properties: { title: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "tags"], additionalProperties: false };
const conforms = (s) => { try { const o = JSON.parse(s); return typeof o.title === "string" && Array.isArray(o.tags) && o.tags.every((t) => typeof t === "string") && Object.keys(o).every(k => k==="title"||k==="tags") ? "VALID" : "JSON_BUT_NOT_SCHEMA"; } catch { return "NOT_JSON"; } };
const red = (s) => String(s).split(KEY).join("[REDACTED]");
const probes = {
  "openai-chat response_format=json_schema": ["https://api.minimaxi.com/v1/chat/completions", { authorization: `Bearer ${KEY}` }, { model: MODEL, reasoning_effort: "low", max_completion_tokens: 2048, messages: [{ role: "user", content: PROMPT }], response_format: { type: "json_schema", json_schema: { name: "video_meta", strict: true, schema } } }, (d) => d.choices?.[0]?.message?.content],
  "openai-chat response_format=json_object": ["https://api.minimaxi.com/v1/chat/completions", { authorization: `Bearer ${KEY}` }, { model: MODEL, reasoning_effort: "low", max_completion_tokens: 2048, messages: [{ role: "user", content: PROMPT }], response_format: { type: "json_object" } }, (d) => d.choices?.[0]?.message?.content],
  "openai-chat forced tool_choice(function)": ["https://api.minimaxi.com/v1/chat/completions", { authorization: `Bearer ${KEY}` }, { model: MODEL, reasoning_effort: "low", max_completion_tokens: 2048, messages: [{ role: "user", content: PROMPT }], tools: [{ type: "function", function: { name: "video_meta", description: "Return the structured result", parameters: schema } }], tool_choice: { type: "function", function: { name: "video_meta" } } }, (d) => { const m = d.choices?.[0]?.message; return m?.tool_calls?.[0] ? `TOOL:${m.tool_calls[0].function?.name}:` + m.tool_calls[0].function?.arguments : m?.content; }],
  "openai-responses text.format=json_schema": ["https://api.minimaxi.com/v1/responses", { authorization: `Bearer ${KEY}` }, { model: MODEL, reasoning: { effort: "low" }, max_output_tokens: 2048, input: PROMPT, text: { format: { type: "json_schema", name: "video_meta", strict: true, schema } } }, (d) => d.output_text ?? (d.output ?? []).filter(i => i.type === "message").flatMap(i => i.content ?? []).map(p => p.text ?? "").join("")],
  "anthropic output_config.format=json_schema": ["https://api.minimaxi.com/anthropic/v1/messages", { authorization: `Bearer ${KEY}`, "anthropic-version": "2023-06-01", "anthropic-beta": "structured-outputs-2025-12-15" }, { model: MODEL, max_tokens: 2048, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content: PROMPT }] }, (d) => (d.content ?? []).filter(b => b.type === "text").map(b => b.text).join("")],
  "anthropic forced tool_choice(tool)": ["https://api.minimaxi.com/anthropic/v1/messages", { authorization: `Bearer ${KEY}`, "anthropic-version": "2023-06-01" }, { model: MODEL, max_tokens: 2048, output_config: { effort: "low" }, tools: [{ name: "video_meta", description: "Return the structured result", input_schema: schema }], tool_choice: { type: "tool", name: "video_meta" }, messages: [{ role: "user", content: PROMPT }] }, (d) => { const t = (d.content ?? []).find(b => b.type === "tool_use"); return t ? `TOOL:${t.name}:` + JSON.stringify(t.input) : (d.content ?? []).filter(b => b.type === "text").map(b => b.text).join(""); }],
};
const only = process.argv.slice(2);
for (const [name, [url, h, body, pick]] of Object.entries(probes)) {
  if (only.length && !only.some(o => name.includes(o))) continue;
  const t0 = Date.now();
  let status, out, err, stop;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    status = r.status; const txt = await r.text(); let d; try { d = JSON.parse(txt); } catch { d = {}; err = txt.slice(0, 300); }
    if (status !== 200 || d.base_resp?.status_code) err = JSON.stringify(d.error ?? d.base_resp ?? d).slice(0, 400);
    out = pick(d) ?? ""; stop = d.stop_reason ?? d.choices?.[0]?.finish_reason ?? d.status;
  } catch (e) { err = String(e.message ?? e); }
  const raw = typeof out === "string" ? out : JSON.stringify(out);
  const payload = raw.startsWith("TOOL:") ? raw.slice(raw.indexOf(":", 5) + 1) : raw.trim();
  console.log(JSON.stringify({ probe: name, status, stop, ms: Date.now() - t0, verdict: err ? "ERROR" : conforms(payload), error: err && red(err), output: red(raw).slice(0, 400) }));
}
