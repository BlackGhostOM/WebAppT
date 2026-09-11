/**
 * Provider-agnostic LLM contract. Agents only ever talk to `LLMProvider`, so
 * the vendor can be swapped (Anthropic, an OpenAI-compatible endpoint such as
 * xAI Grok, or the deterministic mock used in tests and offline development).
 */
import type { LlmProvider } from "../vocab";

export type JsonSchema = Record<string, unknown>;

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  /** Legacy (schema 1.1 transcripts): a flattened web search hit. New transcripts keep the provider block instead. */
  | { type: "web_search_result"; url: string; title: string; snippet: string; retrievedAt: number }
  /**
   * A provider-native block that must be sent back verbatim on the next call
   * (server-side tool use, web search results with their encrypted page
   * content, thinking blocks). `kind` is the provider's block type; `summary`
   * is a short human-readable note for logs.
   */
  | { type: "raw"; provider: "anthropic"; kind: string; block: unknown; summary?: string; retrievedAt?: number };

export interface LlmMessage {
  role: "user" | "assistant";
  content: LlmContentBlock[];
}

export interface LlmRequest {
  model: string;
  /** Stable agent instructions (cached across calls). */
  systemPrompt: string;
  /** Stable company context (cached across calls). */
  companyContext: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  maxTokens: number;
  /** Enables the provider's server-side web search tool when supported. */
  webSearch?: boolean;
  /** Searches allowed per model call (provider `max_uses`). */
  webSearchMaxUses?: number;
  signal?: AbortSignal;
}

export type LlmStopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "other";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Server-side web searches performed during the call (billed per request). */
  webSearchRequests?: number;
}

export interface LlmResponse {
  content: LlmContentBlock[];
  stopReason: LlmStopReason;
  usage: LlmUsage;
  model: string;
  provider: LlmProvider;
}

export interface LLMProvider {
  readonly name: LlmProvider;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
