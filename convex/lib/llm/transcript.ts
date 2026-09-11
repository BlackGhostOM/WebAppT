/**
 * Keeps a task transcript within Convex's 1 MiB document limit.
 *
 * Strategy (lossy only for old material): the first user message (task
 * context) and the most recent turns are kept verbatim. Older turns lose their
 * thinking blocks, their web-search page content (kept as a list of sources)
 * and long tool results; if the transcript is still too large the middle is
 * replaced by a single note, then the latest search results are trimmed to
 * their first hits. Agents are told when history was compacted.
 */
import type { LlmContentBlock, LlmMessage } from "./types";

/** Bytes, not characters: Arabic text is 2–3 bytes per character in UTF-8. */
export const MAX_TRANSCRIPT_BYTES = 800_000;
const KEEP_RECENT_MESSAGES = 6;
const OLD_TOOL_RESULT_CHARS = 1_500;
const RECENT_SEARCH_RESULTS_KEPT = 5;

const encoder = new TextEncoder();
export function sizeOf(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

interface RawSearchResult {
  type?: string;
  url?: string;
  title?: string;
}

/** Old provider blocks → short text so the pairing server_tool_use/result stays consistent. */
function summariseRaw(block: Extract<LlmContentBlock, { type: "raw" }>): LlmContentBlock | null {
  if (block.kind === "thinking" || block.kind === "redacted_thinking") return null;
  if (block.kind === "server_tool_use") return { type: "text", text: block.summary ?? "[أداة خادمية]" };
  if (block.kind === "web_search_tool_result") {
    const content = (block.block as { content?: RawSearchResult[] | { error_code?: string } }).content;
    if (Array.isArray(content)) {
      const lines = content.filter((r) => r.type === "web_search_result" && r.url).slice(0, 10).map((r) => `- ${r.title ?? ""} — ${r.url}`);
      return { type: "text", text: `[نتائج بحث سابقة — المحتوى أُزيل للاختصار؛ ${content.length} نتائج]\n${lines.join("\n")}` };
    }
    return { type: "text", text: block.summary ?? "[بحث ويب] خطأ" };
  }
  return { type: "text", text: block.summary ?? `[${block.kind}]` };
}

function compactOldMessages(messages: LlmMessage[]): LlmMessage[] {
  const cutoff = Math.max(1, messages.length - KEEP_RECENT_MESSAGES);
  const lastAssistant = [...messages].reverse().findIndex((m) => m.role === "assistant");
  const lastAssistantIndex = lastAssistant === -1 ? -1 : messages.length - 1 - lastAssistant;
  return messages.map((m, i) => {
    if (i === 0) return m;
    const content: LlmContentBlock[] = [];
    for (const b of m.content) {
      // Thinking from earlier assistant turns is never needed again.
      if (b.type === "raw" && (b.kind === "thinking" || b.kind === "redacted_thinking") && i !== lastAssistantIndex) continue;
      if (i >= cutoff) {
        content.push(b);
        continue;
      }
      if (b.type === "tool_result" && b.content.length > OLD_TOOL_RESULT_CHARS) content.push({ ...b, content: `${b.content.slice(0, OLD_TOOL_RESULT_CHARS)}…(اختُصر لتوفير السياق)` });
      else if (b.type === "raw") {
        const s = summariseRaw(b);
        if (s) content.push(s);
      } else content.push(b);
    }
    return { ...m, content };
  });
}

/** Keeps only the first hits of the most recent search results (the model already read them all). */
function trimRecentSearchResults(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((m) => ({
    ...m,
    content: m.content.map((b) => {
      if (b.type !== "raw" || b.kind !== "web_search_tool_result") return b;
      const block = b.block as { content?: unknown };
      if (!Array.isArray(block.content) || block.content.length <= RECENT_SEARCH_RESULTS_KEPT) return b;
      return { ...b, block: { ...block, content: block.content.slice(0, RECENT_SEARCH_RESULTS_KEPT) }, summary: `${b.summary ?? ""} (احتُفظ بأول ${RECENT_SEARCH_RESULTS_KEPT})` };
    }),
  }));
}

export function compactTranscript(messages: LlmMessage[], maxBytes: number = MAX_TRANSCRIPT_BYTES): LlmMessage[] {
  if (sizeOf(messages) <= maxBytes) return messages;
  let compacted = compactOldMessages(messages);
  if (sizeOf(compacted) <= maxBytes) return compacted;
  // Drop the middle, keep the task context and the latest turns; preserve tool_use/tool_result pairing
  // by cutting at an assistant-message boundary.
  const head = compacted[0];
  let tailStart = Math.max(1, compacted.length - KEEP_RECENT_MESSAGES);
  while (tailStart < compacted.length && compacted[tailStart].role !== "assistant") tailStart += 1;
  const tail = compacted.slice(tailStart);
  const note: LlmMessage = {
    role: "user",
    content: [{ type: "text", text: `[ملاحظة النظام] اختُصر جزء من سجل المحادثة (${tailStart - 1} رسالة) لتجاوز حد الحجم؛ أعد استدعاء الأدوات إن احتجت تفاصيل أُزيلت.` }],
  };
  compacted = [head, note, ...tail];
  if (sizeOf(compacted) <= maxBytes) return compacted;
  compacted = trimRecentSearchResults(compacted);
  if (sizeOf(compacted) <= maxBytes) return compacted;
  // Last resort: hard-truncate remaining tool results and long text.
  return compacted.map((m) => ({
    ...m,
    content: m.content.map((b) => (b.type === "tool_result" && b.content.length > OLD_TOOL_RESULT_CHARS ? { ...b, content: `${b.content.slice(0, OLD_TOOL_RESULT_CHARS)}…` } : b.type === "text" && b.text.length > 20_000 ? { ...b, text: `${b.text.slice(0, 20_000)}…` } : b)),
  }));
}
