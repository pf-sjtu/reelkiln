// DRY-RUN ONLY (harness debugging, $0): a scripted stand-in for MiniMax's Anthropic-compatible chat + t2a media API.
// It reads the composer prompt and answers with the tool_use the prompt asks for; never used as evidence of a real run.
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 47999);
const sse = (res, events) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const [t, d] of events) res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`); res.end(); };
const textOf = (c) => typeof c === "string" ? c : (c ?? []).map((b) => b.type === "text" ? b.text : b.type === "tool_result" ? "[tool_result] " + JSON.stringify(b.content).slice(0, 400) : "").join("\n");
let n = 0;
createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const u = new URL(req.url, "http://x");
  if (u.pathname.endsWith("/v1/t2a_v2")) { const j = JSON.parse(body); const audio = Buffer.alloc(4096, 1); audio.write("ID3"); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: { audio: audio.toString("hex"), status: 2 }, extra_info: { usage_characters: [...j.text].reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1), 0) }, base_resp: { status_code: 0 } })); }
  if (u.pathname.endsWith("/count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ input_tokens: 1000 })); }
  if (!u.pathname.endsWith("/v1/messages")) { res.writeHead(404); return res.end("{}"); }
  const j = JSON.parse(body);
  { const sys = typeof j.system === "string" ? j.system : (j.system ?? []).map((b) => b.text).join("\n"); (await import("node:fs")).appendFileSync((process.env.FAKE_REQ_LOG ?? "/tmp/m15-fake-req.log"), JSON.stringify({ n, tools: (j.tools ?? []).length, sys: sys.slice(0, 600), sysTail: sys.slice(-2500), stop: j.stop_sequences, maxTok: j.max_tokens, last: JSON.stringify(j.messages?.at(-1)).slice(0, 1500) }) + "\n"); }
  const msgs = j.messages ?? []; const last = msgs[msgs.length - 1];
  const firstUser = [...msgs].reverse().find((m) => m.role === "user" && textOf(m.content).includes("现在只做一件事") || m.role === "user" && /只回复 OK/.test(textOf(m.content)));
  const lastText = textOf(last?.content);
  const pIdx = msgs.lastIndexOf(firstUser);
  const afterPromptHasResult = msgs.slice(pIdx + 1).some((m) => m.role === "user" && textOf(m.content).includes("[tool_result]")) || lastText.includes("[tool_result]");
  const tools = (j.tools ?? []).map((t) => t.name);
  const tool = (suffix) => tools.find((t) => t.endsWith(suffix));
  let blocks;
  const prompt = textOf(firstUser?.content ?? "");
  const code = /(VC[A-Z0-9]{5})/.exec(prompt)?.[1] ?? "";
  const sysAll = typeof j.system === "string" ? j.system : (j.system ?? []).map((b) => b.text).join("\n");
  if (/security monitor for autonomous/.test(sysAll)) blocks = [{ type: "text", text: "<block>no</block>" }];
  else if (afterPromptHasResult || !tools.length) blocks = [{ type: "text", text: `完成 ${code}` }];
  else if (/call_model/.test(prompt) && tool("call_model")) {
    const job = /job_id 为 "([^"]+)"/.exec(prompt)?.[1]; const text = /"text": ("(?:[^"\\]|\\.)*")/.exec(prompt)?.[1];
    blocks = [{ type: "tool_use", id: `toolu_${++n}`, name: tool("call_model"), input: { model_id: "minimax/speech-2.8-turbo", job_id: job, input: { text: JSON.parse(text), voice_id: "female-shaonv" } } }];
  } else if (/request_files/.test(prompt) && tool("request_files")) {
    const dest = /dest_dir 为 "([^"]+)"/.exec(prompt)?.[1];
    blocks = [{ type: "tool_use", id: `toolu_${++n}`, name: tool("request_files"), input: { description: "请提供一张参考图（PNG）", dest_dir: dest, accept: [".png"] } }];
  } else if (/project_memory/.test(prompt) && tool("project_memory")) {
    blocks = [{ type: "tool_use", id: `toolu_${++n}`, name: tool("project_memory"), input: { action: "save", text: "片尾统一使用白色字幕" } }];
  } else blocks = [{ type: "text", text: `OK ${code}` }];
  const usage = { input_tokens: 1200, output_tokens: 40 };
  if (!j.stream) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id: `msg_${n}`, type: "message", role: "assistant", model: j.model, content: blocks, stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage })); }
  const ev = [["message_start", { message: { id: `msg_${++n}`, type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, usage: { input_tokens: 1200, output_tokens: 1 } } }]];
  blocks.forEach((b, i) => {
    if (b.type === "text") { ev.push(["content_block_start", { index: i, content_block: { type: "text", text: "" } }], ["content_block_delta", { index: i, delta: { type: "text_delta", text: b.text } }]); }
    else { ev.push(["content_block_start", { index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }], ["content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]); }
    ev.push(["content_block_stop", { index: i }]);
  });
  ev.push(["message_delta", { delta: { stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } }], ["message_stop", {}]);
  sse(res, ev);
}).listen(port, "127.0.0.1", () => console.log(`fake minimax on ${port}`));
