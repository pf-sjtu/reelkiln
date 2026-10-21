// docs/17: structured (JSON-Schema) output for helper calls — normalisation of the three request
// spellings, per-protocol "native" passthrough (response_format / text.format / output_config.format),
// "tool" emulation (forced tool call, verified necessary for MiniMax), "off", and extraction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildRequestBody, extractText } from "../src/main/llm/protocols";
import { LlmProviderError } from "../src/main/llm/errors";
import { loadProviderRegistry } from "../src/main/llm/provider-registry";
import { anthropicMessages, resolveHelperCreds } from "../src/main/llm/llm-route";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { MINIMAX_PRESET } from "../src/main/llm/provider-config";
import { STRUCTURED_TOOL_NAME, takeOutputFormat } from "../src/main/llm/structured-output";

const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
const base = (extra: Record<string, unknown> = {}) => ({ model: "claude-x", max_tokens: 64, system: "sys", messages: [{ role: "user", content: "title?" }], ...extra });
const anthropicFmt = { output_config: { effort: "low", format: { type: "json_schema", schema } } };
const openaiFmt = { response_format: { type: "json_schema", json_schema: { name: "video_title", schema, strict: true } } };

test("takeOutputFormat: three spellings normalise; output_config keeps effort; text = none; two spellings = error", () => {
  const a = takeOutputFormat(base(anthropicFmt));
  assert.deepEqual(a.format, { kind: "json_schema", name: "output", schema });
  assert.deepEqual(a.body.output_config, { effort: "low" });
  const b = takeOutputFormat(base({ output_format: { type: "json_schema", schema } }));
  assert.equal(b.format?.kind, "json_schema");
  assert.ok(!("output_format" in b.body));
  const c = takeOutputFormat(base(openaiFmt));
  assert.deepEqual(c.format, { kind: "json_schema", name: "video_title", schema, strict: true });
  assert.deepEqual(takeOutputFormat(base({ response_format: { type: "json_object" } })).format, { kind: "json_object", name: "output" });
  assert.equal(takeOutputFormat(base({ response_format: { type: "text" } })).format, undefined);
  assert.throws(() => takeOutputFormat(base({ ...anthropicFmt, ...openaiFmt })), (e) => e instanceof LlmProviderError && e.code === "UNSUPPORTED_CONTENT");
  assert.throws(() => takeOutputFormat(base({ response_format: { type: "xml" } })), /unsupported type/);
});

test("native: openai-chat gets response_format json_schema (passthrough from either spelling) + reasoning_effort from output_config.effort", () => {
  for (const extra of [anthropicFmt, openaiFmt]) {
    const out = buildRequestBody("openai-chat-completions", base(extra), { model: "gpt-x" }) as any;
    assert.equal(out.response_format.type, "json_schema");
    assert.deepEqual(out.response_format.json_schema.schema, schema);
    assert.ok(!("output_config" in out));
    assert.ok(!("tools" in out));
  }
  const fromAnth = buildRequestBody("openai-chat-completions", base(anthropicFmt), {}) as any;
  assert.equal(fromAnth.reasoning_effort, "low");
  const fromOai = buildRequestBody("openai-chat-completions", base(openaiFmt), {}) as any;
  assert.deepEqual(fromOai.response_format, openaiFmt.response_format); // exact passthrough (name + strict kept)
  const jo = buildRequestBody("openai-chat-completions", base({ response_format: { type: "json_object" } }), {}) as any;
  assert.deepEqual(jo.response_format, { type: "json_object" });
});

test("native: responses gets text.format; anthropic gets output_config.format (also from response_format)", () => {
  const r = buildRequestBody("openai-responses", base(openaiFmt), {}) as any;
  assert.deepEqual(r.text, { format: { type: "json_schema", name: "video_title", schema, strict: true } });
  const re = buildRequestBody("openai-responses", base(anthropicFmt), {}) as any;
  assert.deepEqual(re.reasoning, { effort: "low" });
  const a = buildRequestBody("anthropic-messages", base(openaiFmt), {}) as any;
  assert.deepEqual(a.output_config, { format: { type: "json_schema", schema } });
  assert.ok(!("response_format" in a));
  const a2 = buildRequestBody("anthropic-messages", base(anthropicFmt), {}) as any;
  assert.deepEqual(a2.output_config, { effort: "low", format: { type: "json_schema", schema } });
});

test("tool mode: one forced tool per protocol, no native field; caller tools kept", () => {
  const a = buildRequestBody("anthropic-messages", base(anthropicFmt), { structuredOutput: "tool" }) as any;
  assert.deepEqual(a.output_config, { effort: "low" });
  assert.equal(a.tools.length, 1);
  assert.equal(a.tools[0].name, STRUCTURED_TOOL_NAME);
  assert.deepEqual(a.tools[0].input_schema, schema);
  assert.deepEqual(a.tool_choice, { type: "tool", name: STRUCTURED_TOOL_NAME });
  const c = buildRequestBody("openai-chat-completions", base({ ...openaiFmt, tools: [{ name: "other", input_schema: { type: "object" } }] }), { structuredOutput: "tool" }) as any;
  assert.ok(!("response_format" in c));
  assert.deepEqual(c.tools.map((t: any) => t.function.name), ["other", STRUCTURED_TOOL_NAME]);
  assert.deepEqual(c.tools[1].function.parameters, schema);
  assert.deepEqual(c.tool_choice, { type: "function", function: { name: STRUCTURED_TOOL_NAME } });
  const r = buildRequestBody("openai-responses", base({ response_format: { type: "json_object" } }), { structuredOutput: "tool" }) as any;
  assert.deepEqual(r.tools, [{ type: "function", name: STRUCTURED_TOOL_NAME, description: r.tools[0].description, parameters: { type: "object" } }]);
  assert.deepEqual(r.tool_choice, { type: "function", name: STRUCTURED_TOOL_NAME });
});

test("off mode drops the format and reports it", () => {
  let dropped: string[] = [];
  const out = buildRequestBody("openai-chat-completions", base(openaiFmt), { structuredOutput: "off", onDropped: (f) => (dropped = f) }) as any;
  assert.ok(!("response_format" in out) && !("tools" in out));
  assert.ok(dropped.includes("structured_output"));
});

test("extractText: structured tool call wins (anthropic tool_use / chat tool_calls / responses function_call); JSON normalised", () => {
  assert.equal(extractText("anthropic-messages", { content: [{ type: "thinking", thinking: "x" }, { type: "tool_use", name: STRUCTURED_TOOL_NAME, input: { title: "T" } }] }), '{"title":"T"}');
  assert.equal(extractText("openai-chat-completions", { choices: [{ message: { content: "", tool_calls: [{ function: { name: STRUCTURED_TOOL_NAME, arguments: '{ "title" : "T" }' } }] } }] }), '{"title":"T"}');
  assert.equal(extractText("openai-responses", { output: [{ type: "reasoning" }, { type: "function_call", name: STRUCTURED_TOOL_NAME, arguments: '{"title":"T"}' }] }), '{"title":"T"}');
  // other tool names are not the answer; invalid JSON arguments come back raw for the caller to reject
  assert.equal(extractText("anthropic-messages", { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "other", input: {} }] }), "hi");
  assert.equal(extractText("openai-chat-completions", { choices: [{ message: { tool_calls: [{ function: { name: STRUCTURED_TOOL_NAME, arguments: "{oops" } }] } }] }), "{oops");
});

test("MiniMax preset uses tool mode; user file can switch to native", () => {
  assert.equal(MINIMAX_PRESET.structuredOutput, "tool");
  const reg = loadProviderRegistry({ json: { providers: [{ name: "minimax", structuredOutput: "native" }, { name: "x", protocol: "openai-chat-completions", baseUrl: "https://x.test/v1", apiKeyEnv: "X_KEY", model: "m" }] } });
  assert.equal(reg.get("minimax")!.structuredOutput, "native");
  assert.equal(reg.get("x")!.structuredOutput, "native");
  assert.equal(loadProviderRegistry({ json: { providers: [] } }).get("minimax")!.structuredOutput, "tool");
  assert.throws(() => loadProviderRegistry({ json: { providers: [{ name: "minimax", structuredOutput: "json" }] } }), /structuredOutput/);
});

test("end-to-end (mock): openai-chat provider in tool mode — wire body carries the forced tool, result is the JSON", async () => {
  setLoggerForTests(createLogger({ level: "silent" }));
  resetProviderGatesForTests();
  const seen: any[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { content: "", reasoning_content: "…", tool_calls: [{ id: "c1", type: "function", function: { name: STRUCTURED_TOOL_NAME, arguments: '{"title":"Surf Cat"}' } }] } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const registry = loadProviderRegistry({ json: { providers: [{ name: "mmo", protocol: "openai-chat-completions", baseUrl: url, apiKeyEnv: "MMO_KEY", model: "MiniMax-M3.1-Flash", structuredOutput: "tool" }] } });
    const creds = resolveHelperCreds({ llmRoute: "mmo", gatewayUrl: "x" }, { MMO_KEY: "mmo-test-key-0000000" }, registry)!;
    assert.equal(creds.structuredOutput, "tool");
    const r = await anthropicMessages(creds, base(anthropicFmt), { timeoutMs: 5000 });
    assert.deepEqual(r, { ok: true, text: '{"title":"Surf Cat"}' });
    assert.equal(seen[0].tool_choice.function.name, STRUCTURED_TOOL_NAME);
    assert.equal(seen[0].reasoning_effort, "low");
    assert.ok(!("response_format" in seen[0]) && !("output_config" in seen[0]));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    setLoggerForTests(undefined);
  }
});
