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

const COMPLAINT_WORDS = /سيئ|شكو|استرداد|غضب|أسوأ|تأخر|خدع|كذب|complain|refund|terrible|awful|worst|angry|late/i;
const BOOKING_WORDS = /حجز|أحجز|نحجز|book|reserv/i;

/**
 * Deterministic stand-in for the support agent: the inbound message is quoted
 * in the task request between <<< and >>> together with its interaction id.
 */
function mockSupportReply(script: string, toolNames: string[]): Record<string, unknown> | null {
  if (!toolNames.includes("propose_reply")) return null;
  const id = /معرّف الرسالة: (\S+)/.exec(script)?.[1];
  const body = /<<<\n([\s\S]*?)\n>>>/.exec(script)?.[1] ?? "";
  if (!id || !body) return null;
  const english = (body.match(/[A-Za-z]/g) ?? []).length > (body.match(/[؀-ۿ]/g) ?? []).length;
  const kind = COMPLAINT_WORDS.test(body) ? "COMPLAINT" : BOOKING_WORDS.test(body) ? "BOOKING_REQUEST" : "INQUIRY";
  const reply =
    kind === "COMPLAINT"
      ? english
        ? "(simulation) We are truly sorry for your experience. A member of our team will contact you personally today to look into what happened."
        : "(وضع المحاكاة) نعتذر بصدق عمّا واجهتموه. سيتواصل معكم أحد مسؤولينا شخصياً اليوم للاطلاع على ما حدث ومعالجته."
      : kind === "BOOKING_REQUEST"
        ? english
          ? "(simulation) Thank you for your interest! To prepare the right option, could you share your preferred dates and the number of travellers?"
          : "(وضع المحاكاة) شكراً لاهتمامكم! لنُعدّ الخيار المناسب، هل تشاركوننا التواريخ المفضلة وعدد المسافرين؟"
        : english
          ? "(simulation) Thank you for reaching out. We have received your message and our team will get back to you with the details shortly."
          : "(وضع المحاكاة) شكراً لتواصلكم معنا. استلمنا رسالتكم وسيعود إليكم فريقنا بالتفاصيل قريباً.";
  return { interactionId: id, kind, confidence: kind === "INQUIRY" ? 0.9 : 0.85, reply, faq: false };
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

      // [[search_limit]] → behaves like a run that exhausted the web-search budget and stopped.
      if (/\[\[search_limit\]\]/.test(script)) {
        return {
          content: [
            { type: "raw", provider: "anthropic", kind: "server_tool_use", block: { type: "server_tool_use", id: "srvtoolu_mock", name: "web_search", input: { query: "hotel price nizwa" } }, summary: "[بحث ويب] hotel price nizwa" },
            { type: "raw", provider: "anthropic", kind: "web_search_tool_result", block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_mock", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }, summary: "[بحث ويب] خطأ: max_uses_exceeded" },
            { type: "text", text: "(وضع المحاكاة) تعذّر إكمال البحث: تجاوزت حد عمليات البحث." },
          ],
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

      // Support tasks: classify by simple keyword rules and propose a neutral acknowledgement
      // (no prices, no booking confirmation) so the whole inbox → approval flow runs without a key.
      const supportReply = mockSupportReply(script, request.tools.map((t) => t.name));
      if (supportReply) {
        return { content: [{ type: "tool_use", id: nextId(), name: "propose_reply", input: supportReply }], stopReason: "tool_use", usage, model: "mock", provider: "mock" };
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
