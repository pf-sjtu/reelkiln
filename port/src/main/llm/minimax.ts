// PORT-NEW: MiniMax compatibility layer (docs/14 → docs/15). MiniMax is no longer special-cased:
// it is the built-in preset MINIMAX_PRESET of the generic provider framework (provider-config.ts),
// and llmRoute "minimax" is just a provider route. This module keeps the docs/14 helper names as
// thin wrappers so existing callers/CLI keep working.
//
// SECURITY: the key is read from the environment at call time only; describeMiniMaxConfig() /
// describeProvider() are the only representations meant for output.
import { LlmProviderError } from "./errors";
import { MINIMAX_PRESET, parseProviderConfigs } from "./provider-config";
import { describeProvider, resolveProviderConfig, type ResolvedProvider } from "./provider-registry";
import { ConcurrencyLimiter, providerGate, resetProviderGatesForTests, withRetry, type RetryOptions } from "./retry";

export const MINIMAX_ROUTE = "minimax" as const;
export const MINIMAX_DEFAULT_BASE_URL = MINIMAX_PRESET.baseUrl; // https://api.minimaxi.com/anthropic
export const MINIMAX_DEFAULT_MODEL = MINIMAX_PRESET.model; // MiniMax-M3.1-Flash
export const MINIMAX_MAX_CONCURRENCY_CAP = 2;

export type MiniMaxConfig = ResolvedProvider;
const minimaxPresetConfig = () => parseProviderConfigs([], [MINIMAX_PRESET])[0];

/** The built-in MiniMax preset resolved against `env` (MINIMAX_API_KEY / _BASE_URL / _MODEL /
 *  _MAX_CONCURRENCY). Call with the UNSANITIZED env. null when the key is missing/blank. */
export function minimaxConfig(env: NodeJS.ProcessEnv = process.env): MiniMaxConfig | null {
  return resolveProviderConfig(minimaxPresetConfig(), env);
}
export function describeMiniMaxConfig(mm: MiniMaxConfig | null) { return describeProvider(mm); }

export { ConcurrencyLimiter, LlmProviderError as MiniMaxError, type RetryOptions };
export const minimaxGate = (mm: Pick<MiniMaxConfig, "maxConcurrency">) => providerGate(MINIMAX_ROUTE, mm.maxConcurrency);
export const resetMiniMaxGateForTests = resetProviderGatesForTests;
/** docs/14 retry behaviour = the preset's policy. */
export function withMiniMaxRetry(attempt: () => Promise<Response>, o: RetryOptions = {}): Promise<Response> {
  return withRetry(attempt, minimaxPresetConfig().retry, o, { provider: MINIMAX_ROUTE, keyEnv: "MINIMAX_API_KEY" });
}
export { backoffDelayMs, retryAfterMs } from "./retry";
