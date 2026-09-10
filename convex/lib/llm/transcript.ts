/**
 * Keeps a task transcript within Convex's 1 MiB document limit.
 *
 * Strategy (lossy only for old tool output): the first user message (task
 * context) and the most recent turns are kept verbatim; older tool results are
 * truncated, and if the transcript is still too large the middle is replaced
 * by a single note. Agents are told when history was compacted.
 */
import type { LlmContentBlock, LlmMessage } from "./types";

export const MAX_TRANSCRIPT_CHARS = 350_000;
const KEEP_RECENT_MESSAGES = 6;
const OLD_TOOL_RESULT_CHARS = 1_500;

function sizeOf(value: unknown): number {
  return JSON.stringify(value).length;
}

function truncateOldToolResults(messages: LlmMessage[]): LlmMessage[] {
  const cutoff = Math.max(1, messages.length - KEEP_RECENT_MESSAGES);
  return messages.map((m, i) => {
    if (i === 0 || i >= cutoff || m.role !== "user") return m;
    const content: LlmContentBlock[] = m.content.map((b) =>
      b.type === "tool_result" && b.content.length > OLD_TOOL_RESULT_CHARS ? { ...b, content: `${b.content.slice(0, OLD_TOOL_RESULT_CHARS)}…(اختُصر لتوفير السياق)` } : b,
    );
    return { ...m, content };
  });
}

export function compactTranscript(messages: LlmMessage[], maxChars: number = MAX_TRANSCRIPT_CHARS): LlmMessage[] {
  if (sizeOf(messages) <= maxChars) return messages;
  let compacted = truncateOldToolResults(messages);
  if (sizeOf(compacted) <= maxChars) return compacted;
  // Drop the middle, keep the task context and the latest turns; preserve tool_use/tool_result pairing
  // by cutting at a user-message boundary.
  const head = compacted[0];
  let tailStart = Math.max(1, compacted.length - KEEP_RECENT_MESSAGES);
  while (tailStart < compacted.length && compacted[tailStart].role !== "assistant") tailStart += 1;
  const tail = compacted.slice(tailStart);
  const note: LlmMessage = {
    role: "user",
    content: [{ type: "text", text: `[ملاحظة النظام] اختُصر جزء من سجل المحادثة (${tailStart - 1} رسالة) لتجاوز حد الحجم؛ أعد استدعاء الأدوات إن احتجت تفاصيل أُزيلت.` }],
  };
  compacted = [head, note, ...tail];
  // Last resort: hard-truncate remaining tool results.
  if (sizeOf(compacted) > maxChars) {
    compacted = compacted.map((m) => ({
      ...m,
      content: m.content.map((b) => (b.type === "tool_result" && b.content.length > OLD_TOOL_RESULT_CHARS ? { ...b, content: `${b.content.slice(0, OLD_TOOL_RESULT_CHARS)}…` } : b.type === "text" && b.text.length > 20_000 ? { ...b, text: `${b.text.slice(0, 20_000)}…` } : b)),
    }));
  }
  return compacted;
}
