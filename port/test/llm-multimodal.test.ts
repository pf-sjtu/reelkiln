// Anthropic → OpenAI content conversion (docs/15 §3.3): images, documents, tools survive the
// translation per protocol schema; unrepresentable content is a typed error, never silently dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildRequestBody } from "../src/main/llm/protocols";
import { LlmProviderError } from "../src/main/llm/errors";
import { loadProviderRegistry } from "../src/main/llm/provider-registry";
import { anthropicMessages, resolveHelperCreds } from "../src/main/llm/llm-route";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF = "JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PD4+CmVuZG9iagp0cmFpbGVyCjw8Pj4KJSVFT0YK";
const img = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } };
const imgUrl = { type: "image", source: { type: "url", url: "https://example.test/cat.jpg" } };
const pdf = { type: "document", title: "spec.pdf", source: { type: "base64", media_type: "application/pdf", data: PDF } };
const pdfUrl = { type: "document", source: { type: "url", url: "https://example.test/a.pdf" } };
const body = (content: unknown, extra: Record<string, unknown> = {}) => ({ model: "claude-x", max_tokens: 50, system: [{ type: "text", text: "sys" }], messages: [{ role: "user", content }], ...extra });
const isUC = (re: RegExp) => (e: unknown) => e instanceof LlmProviderError && e.code === "UNSUPPORTED_CONTENT" && re.test(e.message);

test("chat.completions: text+image(base64,url)+pdf → content parts; text-only stays a string; system first", () => {
  const out = buildRequestBody("openai-chat-completions", body([{ type: "text", text: "what is this" }, img, imgUrl, pdf]), { model: "gpt-x" }) as any;
  assert.deepEqual(out.messages[0], { role: "system", content: "sys" });
  assert.deepEqual(out.messages[1], { role: "user", content: [
    { type: "text", text: "what is this" },
    { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
    { type: "image_url", image_url: { url: "https://example.test/cat.jpg" } },
    { type: "file", file: { filename: "spec.pdf", file_data: `data:application/pdf;base64,${PDF}` } },
  ] });
  assert.equal(out.model, "gpt-x");
  assert.equal(out.max_tokens, 50);
  const t = buildRequestBody("openai-chat-completions", body([{ type: "text", text: "a" }, { type: "text", text: "b" }])) as any;
  assert.equal(t.messages[1].content, "a\nb");
  const mc = buildRequestBody("openai-chat-completions", body("hi"), { maxTokensField: "max_completion_tokens" }) as any;
  assert.equal(mc.max_completion_tokens, 50);
  assert.equal(mc.max_tokens, undefined);
});

test("responses: input_text / input_image(detail auto) / input_file(file_data | file_url); instructions; max_output_tokens", () => {
  const out = buildRequestBody("openai-responses", body([{ type: "text", text: "describe" }, img, imgUrl, pdf, pdfUrl]), { model: "gpt-r" }) as any;
  assert.equal(out.instructions, "sys");
  assert.equal(out.max_output_tokens, 50);
  assert.deepEqual(out.input, [{ role: "user", content: [
    { type: "input_text", text: "describe" },
    { type: "input_image", image_url: `data:image/png;base64,${PNG}`, detail: "auto" },
    { type: "input_image", image_url: "https://example.test/cat.jpg", detail: "auto" },
    { type: "input_file", filename: "spec.pdf", file_data: `data:application/pdf;base64,${PDF}` },
    { type: "input_file", file_url: "https://example.test/a.pdf" },
  ] }]);
  assert.deepEqual((buildRequestBody("openai-responses", body("hi")) as any).input, [{ role: "user", content: "hi" }]);
});

test("documents: text / content sources become text; thinking blocks dropped; anthropic passthrough untouched", () => {
  const doc = { type: "document", source: { type: "text", media_type: "text/plain", data: "plain doc" } };
  const cdoc = { type: "document", source: { type: "content", content: [{ type: "text", text: "c1" }, img] } };
  const chat = buildRequestBody("openai-chat-completions", body([doc, cdoc, { type: "thinking", thinking: "…", signature: "s" }])) as any;
  assert.deepEqual(chat.messages[1].content, [{ type: "text", text: "plain doc" }, { type: "text", text: "c1" }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }]);
  const a = body([img, pdf]);
  assert.deepEqual(buildRequestBody("anthropic-messages", a, { model: "m" }), { ...a, model: "m" });
});

test("tools: tool_use/tool_result/tools/tool_choice per protocol; images inside tool_result follow as user content", () => {
  const msgs = [
    { role: "user", content: "weather?" },
    { role: "assistant", content: [{ type: "text", text: "checking" }, { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "SG" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "31C" }, img] }, { type: "text", text: "thanks" }] },
  ];
  const tools = [{ name: "get_weather", description: "w", input_schema: { type: "object", properties: { city: { type: "string" } } } }];
  const b = { model: "x", max_tokens: 10, messages: msgs, tools, tool_choice: { type: "tool", name: "get_weather", disable_parallel_tool_use: true }, stop_sequences: ["END"], top_k: 5, thinking: { type: "enabled", budget_tokens: 1 } };
  const dropped: string[][] = [];
  const chat = buildRequestBody("openai-chat-completions", b, { onDropped: (f) => dropped.push(f) }) as any;
  assert.deepEqual(chat.messages, [
    { role: "user", content: "weather?" },
    { role: "assistant", content: "checking", tool_calls: [{ id: "tu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"SG"}' } }] },
    { role: "tool", tool_call_id: "tu_1", content: "31C" },
    { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }, { type: "text", text: "thanks" }] },
  ]);
  assert.deepEqual(chat.tools, [{ type: "function", function: { name: "get_weather", description: "w", parameters: tools[0].input_schema } }]);
  assert.deepEqual(chat.tool_choice, { type: "function", function: { name: "get_weather" } });
  assert.equal(chat.parallel_tool_calls, false);
  assert.deepEqual(chat.stop, ["END"]);
  assert.equal(chat.top_k, undefined);
  assert.equal(chat.thinking, undefined);
  assert.deepEqual(dropped[0].sort(), ["thinking", "top_k"]);
  const r = buildRequestBody("openai-responses", b) as any;
  assert.deepEqual(r.input, [
    { role: "user", content: "weather?" },
    { role: "assistant", content: "checking" },
    { type: "function_call", call_id: "tu_1", name: "get_weather", arguments: '{"city":"SG"}' },
    { type: "function_call_output", call_id: "tu_1", output: "31C" },
    { role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${PNG}`, detail: "auto" }, { type: "input_text", text: "thanks" }] },
  ]);
  assert.deepEqual(r.tools, [{ type: "function", name: "get_weather", description: "w", parameters: tools[0].input_schema }]);
  assert.deepEqual(r.tool_choice, { type: "function", name: "get_weather" });
  assert.equal(r.stop, undefined);
  assert.equal(buildRequestBody("openai-chat-completions", { messages: [], tool_choice: { type: "any" } }).tool_choice, "required");
});

test("unrepresentable content → UNSUPPORTED_CONTENT (never silently dropped)", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["openai-chat-completions", body([pdfUrl]), /cannot reference a document by URL/],
    ["openai-chat-completions", body([{ type: "image", source: { type: "file", file_id: "file_1" } }]), /image source "file"/],
    ["openai-responses", body([{ type: "image", source: { type: "base64", data: PNG } }]), /media_type/],
    ["openai-responses", body([{ type: "server_tool_use", id: "x", name: "web_search" }]), /server_tool_use/],
    ["openai-chat-completions", { messages: [{ role: "assistant", content: [img] }] }, /assistant messages can only carry text/],
    ["openai-chat-completions", { system: [img], messages: [] }, /system/],
    ["openai-responses", { messages: [], tools: [{ type: "web_search_20250305", name: "web_search" }] }, /tools\[0\]/],
  ];
  for (const [p, b, re] of cases) assert.throws(() => buildRequestBody(p as any, b as any), isUC(re), `${p} ${re}`);
});

test("end-to-end (mock): image reaches an openai-chat provider on the wire; UNSUPPORTED_CONTENT returns {ok:false} without a request", async () => {
  setLoggerForTests(createLogger({ level: "silent" }));
  resetProviderGatesForTests();
  const seen: any[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { seen.push(JSON.parse(raw)); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "a red pixel" } }] })); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const registry = loadProviderRegistry({ json: { providers: [{ name: "vis", protocol: "openai-chat-completions", baseUrl: base, apiKeyEnv: "VIS_KEY", model: "vision-1", chatMaxTokensField: "max_completion_tokens" }] } });
    const creds = resolveHelperCreds({ llmRoute: "vis", gatewayUrl: "x" }, { VIS_KEY: "vis-test-key-0000000" }, registry)!;
    const r = await anthropicMessages(creds, body([{ type: "text", text: "?" }, img]), { timeoutMs: 5000 });
    assert.deepEqual(r, { ok: true, text: "a red pixel" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].model, "vision-1");
    assert.equal(seen[0].max_completion_tokens, 50);
    assert.deepEqual(seen[0].messages[1].content[1], { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } });
    const bad = await anthropicMessages(creds, body([pdfUrl]), { timeoutMs: 5000 });
    assert.equal(bad.ok, false);
    assert.equal((bad as any).code, "UNSUPPORTED_CONTENT");
    assert.equal(seen.length, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    setLoggerForTests(undefined);
  }
});
