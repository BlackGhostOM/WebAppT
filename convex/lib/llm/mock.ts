/**
 * Deterministic mock provider used when no API key is configured and in tests.
 *
 * It never invents business data. It follows small, explicit directives found
 * in the latest user message so tests can script tool calls and delays:
 *   [[tool:NAME:{"json":"input"}]]  → emit a tool_use for NAME
 *   [[delegate:AGENT:title]]         → emit delegate_task to AGENT
 *   [[slow:MS]]                      → wait MS ms (honours AbortSignal)
 *   [[fail]]                         → throw an error
 * Without directives it returns a short Arabic text that states it is running
 * in simulation mode and summarises available tool results.
 */
import type { LlmContentBlock, LlmMessage, LlmRequest, LlmResponse, LLMProvider } from "./types";

function lastUserText(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = m.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    if (text) return text;
  }
  return "";
}

function firstUserText(messages: LlmMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "";
  return first.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
}

function lastToolResults(messages: LlmMessage[]): Extract<LlmContentBlock, { type: "tool_result" }>[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return [];
  return last.content.filter((b) => b.type === "tool_result") as Extract<LlmContentBlock, { type: "tool_result" }>[];
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

let counter = 0;
function nextId() {
  counter += 1;
  return `mock_tool_${counter}`;
}

export function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const usage = { inputTokens: 120, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const script = firstUserText(request.messages);
      const latest = lastUserText(request.messages);
      const results = lastToolResults(request.messages);

      const slow = /[[{]{2}slow:(\d+)[\]}]{2}/.exec(script);
      if (slow) await sleep(Number(slow[1]), request.signal);

      if (/\[\[fail\]\]/.test(latest)) throw new Error("MOCK_FAILURE");

      // After tool results arrive, finish the turn with a summary.
      if (results.length > 0) {
        const summary = results.map((r) => `• ${r.isError ? "خطأ" : "نتيجة"}: ${r.content.slice(0, 300)}`).join("\n");
        return {
          content: [{ type: "text", text: `(وضع المحاكاة) نتائج الأدوات:\n${summary}` }],
          stopReason: "end_turn",
          usage,
          model: "mock",
          provider: "mock",
        };
      }

      // Directives fire only on the first turn; a resumed task (after subtasks or an owner decision) finishes.
      const isFirstTurn = request.messages.filter((m) => m.role === "user").length === 1;
      if (!isFirstTurn) {
        const lastText = lastUserText(request.messages);
        return {
          content: [{ type: "text", text: `(وضع المحاكاة) ملخص تنفيذي بناءً على ما ورد:\n${lastText.slice(0, 600)}` }],
          stopReason: "end_turn",
          usage,
          model: "mock",
          provider: "mock",
        };
      }

      const content: LlmContentBlock[] = [];
      const toolDirectives = [...script.matchAll(/\[\[tool:([a-z_]+):(\{.*?\})\]\]/g)];
      for (const d of toolDirectives) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(d[2]);
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: nextId(), name: d[1], input });
      }
      const delegate = /\[\[delegate:([a-z]+):([^\]]+)\]\]/.exec(script);
      if (delegate && request.tools.some((t) => t.name === "delegate_task")) {
        content.push({
          type: "tool_use",
          id: nextId(),
          name: "delegate_task",
          input: { agentSlug: delegate[1], title: delegate[2], request: delegate[2] },
        });
      }
      if (content.length > 0) {
        return { content, stopReason: "tool_use", usage, model: "mock", provider: "mock" };
      }

      const toolNames = request.tools.map((t) => t.name).slice(0, 6).join(", ");
      return {
        content: [
          {
            type: "text",
            text:
              `(وضع المحاكاة — لم يُضبط مفتاح مزوّد الذكاء الاصطناعي) استلمت طلبك: «${latest.slice(0, 200)}».\n` +
              `لا أستطيع اختراع بيانات؛ الأدوات المتاحة لي: ${toolNames || "لا شيء"}. ` +
              `اضبط ANTHROPIC_API_KEY في بيئة Convex لتفعيل النموذج الحقيقي.`,
          },
        ],
        stopReason: "end_turn",
        usage,
        model: "mock",
        provider: "mock",
      };
    },
  };
}
