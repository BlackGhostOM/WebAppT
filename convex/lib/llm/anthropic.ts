/**
 * Anthropic implementation of `LLMProvider` using `@anthropic-ai/sdk`.
 *
 * - Prompt caching: the agent system prompt, the company context and the tool
 *   list each carry a cache breakpoint (most of the cost is repeated input).
 * - Adaptive thinking on Claude Sonnet 5 / Opus 5; Haiku 4.5 runs without it.
 * - Server-side web search when requested (version chosen per model, `max_uses`
 *   from settings). If the API rejects the tool configuration, the call is
 *   retried once without web search and the degradation is reported in `notes`.
 * - Provider-native blocks (server_tool_use, web_search_tool_result with the
 *   encrypted page content, thinking) are kept verbatim in the transcript and
 *   sent back unchanged, so search results survive tool calls and pauses.
 * - The SDK is imported lazily so the mock path never loads it.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { LlmContentBlock, LlmRequest, LlmResponse, LlmStopReason, LLMProvider } from "./types";

export const DEFAULT_WEB_SEARCH_MAX_USES = 8;

function supportsAdaptiveThinking(model: string): boolean {
  return /sonnet-5|opus-5|opus-4-[678]|sonnet-4-6/.test(model);
}

/**
 * No `user_location`: the API rejects country code "OM" ("Country code OM is not
 * supported"), so the Omani context comes from the prompt and the queries instead.
 */
function webSearchTool(model: string, maxUses: number): Anthropic.Messages.ToolUnion {
  const dynamic = /sonnet-5|opus-5|opus-4-[678]|sonnet-4-6/.test(model);
  return dynamic ? { type: "web_search_20260209", name: "web_search", max_uses: maxUses } : { type: "web_search_20250305", name: "web_search", max_uses: maxUses };
}

/** The subset of the SDK client the provider uses (injectable for tests). */
export interface AnthropicMessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message> };
}

function apiErrorMessage(e: unknown): string {
  const err = e as { status?: number; message?: string; error?: { error?: { message?: string } } };
  return err?.error?.error?.message ?? err?.message ?? String(e);
}

/** A 400 that names the web search tool = our tool configuration was rejected, not the request content. */
function isWebSearchConfigRejection(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 400 && /web_search/i.test(apiErrorMessage(e));
}

/** Transcript → API messages. Raw provider blocks go back exactly as received. */
export function toAnthropicMessages(messages: LlmRequest["messages"]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.flatMap((block): Anthropic.ContentBlockParam[] => {
      switch (block.type) {
        case "text":
          return [{ type: "text", text: block.text }];
        case "tool_use":
          return [{ type: "tool_use", id: block.id, name: block.name, input: block.input }];
        case "tool_result":
          return [{ type: "tool_result", tool_use_id: block.toolUseId, content: block.content, is_error: block.isError }];
        case "web_search_result":
          return [{ type: "text", text: `[بحث] ${block.title} — ${block.url}\n${block.snippet}` }];
        case "raw":
          return block.provider === "anthropic" ? [block.block as Anthropic.ContentBlockParam] : [];
      }
    }),
  }));
}

function mapStopReason(reason: string | null): LlmStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    case "pause_turn":
      return "pause_turn";
    default:
      return "other";
  }
}

/**
 * Maps Anthropic content blocks to the provider-agnostic transcript. Text and
 * client tool calls are normalised; everything else (server tool use, search
 * results, thinking) is kept as a `raw` block with a short summary for logs.
 */
export function fromAnthropicContent(content: Anthropic.ContentBlock[], now: number = Date.now()): LlmContentBlock[] {
  const out: LlmContentBlock[] = [];
  for (const block of content) {
    if (block.type === "text") out.push({ type: "text", text: block.text });
    else if (block.type === "tool_use") out.push({ type: "tool_use", id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    else if (block.type === "server_tool_use") {
      const query = typeof (block.input as { query?: unknown })?.query === "string" ? (block.input as { query: string }).query : undefined;
      out.push({ type: "raw", provider: "anthropic", kind: "server_tool_use", block, summary: query ? `[بحث ويب] ${query}` : `[أداة خادمية] ${block.name}`, retrievedAt: now });
    } else if (block.type === "web_search_tool_result") {
      const results = Array.isArray(block.content) ? block.content.length : 0;
      const error = !Array.isArray(block.content) && block.content && "error_code" in block.content ? String((block.content as { error_code: string }).error_code) : undefined;
      out.push({ type: "raw", provider: "anthropic", kind: "web_search_tool_result", block, summary: error ? `[بحث ويب] خطأ: ${error}` : `[بحث ويب] ${results} نتائج`, retrievedAt: now });
    } else {
      // thinking, redacted_thinking, code execution results…: opaque, round-tripped verbatim.
      out.push({ type: "raw", provider: "anthropic", kind: block.type, block, retrievedAt: now });
    }
  }
  return out;
}

export async function createAnthropicProvider(apiKey?: string, deps: { client?: AnthropicMessagesClient } = {}): Promise<LLMProvider> {
  let client = deps.client;
  if (!client) {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    client = new AnthropicClient({ apiKey, maxRetries: 2, timeout: 5 * 60 * 1000 });
  }
  const api = client;

  return {
    name: "anthropic",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const buildParams = (withWebSearch: boolean): Anthropic.MessageCreateParamsNonStreaming => {
        const tools: Anthropic.Messages.ToolUnion[] = request.tools.map((t, i) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
          ...(i === request.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
        }));
        if (withWebSearch) tools.push(webSearchTool(request.model, Math.max(1, Math.min(20, request.webSearchMaxUses ?? DEFAULT_WEB_SEARCH_MAX_USES))));
        return {
          model: request.model,
          max_tokens: request.maxTokens,
          system: [
            { type: "text", text: request.systemPrompt, cache_control: { type: "ephemeral" } },
            { type: "text", text: request.companyContext, cache_control: { type: "ephemeral" } },
          ],
          messages: toAnthropicMessages(request.messages),
          ...(tools.length > 0 ? { tools } : {}),
          ...(supportsAdaptiveThinking(request.model) ? { thinking: { type: "adaptive" as const } } : {}),
        };
      };

      const notes: string[] = [];
      let response: Anthropic.Message;
      try {
        response = await api.messages.create(buildParams(!!request.webSearch), { signal: request.signal });
      } catch (e) {
        // A rejected web-search configuration must not fail the whole task: retry once without the tool.
        if (!request.webSearch || !isWebSearchConfigRejection(e)) throw e;
        const reason = apiErrorMessage(e);
        console.warn(`[anthropic] web_search tool rejected, retrying without it: ${reason}`);
        notes.push(`web_search_unavailable: ${reason}`);
        response = await api.messages.create(buildParams(false), { signal: request.signal });
      }
      return {
        content: fromAnthropicContent(response.content),
        stopReason: mapStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
          webSearchRequests: response.usage.server_tool_use?.web_search_requests ?? 0,
        },
        model: response.model,
        provider: "anthropic",
        ...(notes.length ? { notes } : {}),
      };
    },
  };
}
