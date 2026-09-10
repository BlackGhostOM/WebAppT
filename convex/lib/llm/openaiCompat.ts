/**
 * OpenAI-compatible chat-completions provider (e.g. xAI Grok). Implements the
 * same `LLMProvider` contract so agent logic is untouched when switching.
 * Uses plain `fetch`; no vendor SDK required.
 */
import type { LlmContentBlock, LlmRequest, LlmResponse, LLMProvider } from "./types";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

function toOpenAiMessages(request: LlmRequest): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: `${request.systemPrompt}\n\n${request.companyContext}` }];
  for (const m of request.messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      const toolCalls = m.content
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          const t = b as Extract<LlmContentBlock, { type: "tool_use" }>;
          return { id: t.id, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.input) } };
        });
      out.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    } else {
      const results = m.content.filter((b) => b.type === "tool_result") as Extract<LlmContentBlock, { type: "tool_result" }>[];
      for (const r of results) out.push({ role: "tool", tool_call_id: r.toolUseId, content: r.content });
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

export function createOpenAiCompatibleProvider(opts: { baseUrl: string; apiKey: string }): LLMProvider {
  return {
    name: "openai_compatible",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const body = {
        model: request.model,
        max_tokens: request.maxTokens,
        messages: toOpenAiMessages(request),
        ...(request.tools.length
          ? {
              tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
            }
          : {}),
      };
      const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(body),
        signal: request.signal ?? AbortSignal.timeout(5 * 60 * 1000),
      });
      if (!res.ok) throw new Error(`OPENAI_COMPAT_HTTP_${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        model: string;
        choices: { finish_reason: string; message: OpenAiMessage }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      const choice = json.choices[0];
      const content: LlmContentBlock[] = [];
      if (choice.message.content) content.push({ type: "text", text: choice.message.content });
      for (const call of choice.message.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
      }
      const cached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      return {
        content,
        stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
        usage: {
          inputTokens: (json.usage?.prompt_tokens ?? 0) - cached,
          outputTokens: json.usage?.completion_tokens ?? 0,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
        },
        model: json.model ?? request.model,
        provider: "openai_compatible",
      };
    },
  };
}
