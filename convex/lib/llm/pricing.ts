/**
 * USD price per million tokens. Kept in one place so the cost dashboard and the
 * budget guard agree. Update when Anthropic publishes new prices.
 */
import type { LlmUsage } from "./types";

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  mock: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const FALLBACK_PRICE: ModelPrice = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export function priceFor(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

/** Anthropic web search: $10 per 1,000 searches (plus normal tokens). */
export const WEB_SEARCH_USD_PER_REQUEST = 0.01;

/** Cost in USD for one call; batch traffic is billed at 50% (search requests are not discounted). */
export function computeCostUsd(model: string, usage: LlmUsage, batch = false): number {
  const p = priceFor(model);
  const raw =
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  const cost = (batch ? raw / 2 : raw) + (usage.webSearchRequests ?? 0) * WEB_SEARCH_USD_PER_REQUEST;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
