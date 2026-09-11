/**
 * Reads web-search provenance out of a transcript: sources (for task citations),
 * the queries the model issued, and any search errors (e.g. `max_uses_exceeded`).
 * Understands the provider-native `raw` blocks and the legacy flattened blocks.
 */
import type { LlmContentBlock } from "./types";

export interface WebSource {
  url: string;
  title?: string;
  pageAge?: string;
  retrievedAt: number;
}

interface RawSearchResult {
  type?: string;
  url?: string;
  title?: string;
  page_age?: string | null;
}

interface RawSearchResultBlock {
  type?: string;
  tool_use_id?: string;
  content?: RawSearchResult[] | { type?: string; error_code?: string };
}

export const SEARCH_LIMIT_ERROR = "max_uses_exceeded";

export function webSourcesOf(blocks: LlmContentBlock[], now: number = Date.now()): WebSource[] {
  const out: WebSource[] = [];
  for (const b of blocks) {
    if (b.type === "web_search_result") out.push({ url: b.url, title: b.title, retrievedAt: b.retrievedAt });
    if (b.type === "raw" && b.kind === "web_search_tool_result") {
      const content = (b.block as RawSearchResultBlock).content;
      if (Array.isArray(content)) {
        for (const r of content) if (r.type === "web_search_result" && typeof r.url === "string") out.push({ url: r.url, title: r.title, pageAge: r.page_age ?? undefined, retrievedAt: b.retrievedAt ?? now });
      }
    }
  }
  return out;
}

export function webSearchQueriesOf(blocks: LlmContentBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "raw" && b.kind === "server_tool_use") {
      const input = (b.block as { input?: { query?: unknown } }).input;
      if (typeof input?.query === "string") out.push(input.query);
    }
  }
  return out;
}

export function webSearchErrorsOf(blocks: LlmContentBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "raw" && b.kind === "web_search_tool_result") {
      const content = (b.block as RawSearchResultBlock).content;
      if (content && !Array.isArray(content) && typeof content.error_code === "string") out.push(content.error_code);
    }
  }
  return out;
}

/** Number of web searches the model issued in this response (successful or not). */
export function webSearchCountOf(blocks: LlmContentBlock[]): number {
  return blocks.filter((b) => b.type === "raw" && b.kind === "server_tool_use" && (b.block as { name?: string }).name === "web_search").length;
}
