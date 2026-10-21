// PORT-NEW (docs/15): shared LLM route types (main + renderer).
/** The two routes the original app knows (main/index.js L319-322). */
export type BuiltinLlmRoute = "claude-code" | "gateway";
/** settings.llmRoute: a built-in route or the name of a registered custom provider. */
export type LlmRouteId = BuiltinLlmRoute | (string & {});
export type LlmProtocolId = "anthropic-messages" | "openai-chat-completions" | "openai-responses";
