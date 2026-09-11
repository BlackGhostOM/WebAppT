import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import { createAnthropicProvider, fromAnthropicContent, toAnthropicMessages } from "../../convex/lib/llm/anthropic";
import { createTask } from "../../convex/services/tasks";
import { compactTranscript, sizeOf } from "../../convex/lib/llm/transcript";
import type { LlmMessage } from "../../convex/lib/llm/types";
import { SEARCH_LIMIT_ERROR, webSearchCountOf, webSearchErrorsOf, webSearchQueriesOf, webSourcesOf } from "../../convex/lib/llm/webSources";
import { setup } from "./helpers";

const now = 1_700_000_000_000;

function searchTurn(id: string, query: string, results: number, encryptedSize = 2000): LlmMessage {
  const content = fromAnthropicContent(
    [
      { type: "server_tool_use", id, name: "web_search", input: { query } },
      {
        type: "web_search_tool_result",
        tool_use_id: id,
        content: Array.from({ length: results }, (_, i) => ({ type: "web_search_result", url: `https://example.com/${id}/${i}`, title: `Hit ${i}`, encrypted_content: "x".repeat(encryptedSize), page_age: null })),
      },
      { type: "text", text: `وجدت ${results} نتائج لـ ${query}` },
    ] as never,
    now,
  );
  return { role: "assistant", content };
}

describe("web search provenance and round-tripping", () => {
  it("sends server tool blocks back to the API verbatim, including the encrypted page content", () => {
    const turn = searchTurn("srvtoolu_1", "Alila Jabal Akhdar price", 3);
    const params = toAnthropicMessages([turn]);
    const blocks = params[0].content as { type: string; content?: unknown; input?: unknown }[];
    expect(blocks.map((b) => b.type)).toEqual(["server_tool_use", "web_search_tool_result", "text"]);
    expect((blocks[0].input as { query: string }).query).toBe("Alila Jabal Akhdar price");
    const results = blocks[1].content as { encrypted_content: string }[];
    expect(results).toHaveLength(3);
    expect(results[0].encrypted_content).toBe("x".repeat(2000));
    // Legacy flattened blocks still degrade to text.
    const legacy = toAnthropicMessages([{ role: "assistant", content: [{ type: "web_search_result", url: "https://a.b", title: "T", snippet: "s", retrievedAt: now }] }]);
    expect((legacy[0].content as { type: string }[])[0].type).toBe("text");
  });

  it("extracts sources, queries and errors from a response", () => {
    const ok = searchTurn("srvtoolu_1", "Falaj Daris Nizwa price", 2).content;
    const failed = fromAnthropicContent(
      [
        { type: "server_tool_use", id: "srvtoolu_2", name: "web_search", input: { query: "4WD rental Muscat" } },
        { type: "web_search_tool_result", tool_use_id: "srvtoolu_2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
        { type: "thinking", thinking: "…", signature: "sig" },
      ] as never,
      now,
    );
    expect(webSourcesOf(ok, now).map((s) => s.url)).toEqual(["https://example.com/srvtoolu_1/0", "https://example.com/srvtoolu_1/1"]);
    expect(webSearchQueriesOf([...ok, ...failed])).toEqual(["Falaj Daris Nizwa price", "4WD rental Muscat"]);
    expect(webSearchErrorsOf(failed)).toEqual([SEARCH_LIMIT_ERROR]);
    expect(webSearchCountOf([...ok, ...failed])).toBe(2);
    expect(failed[2]).toMatchObject({ type: "raw", kind: "thinking" });
    expect(failed[1].type === "raw" && failed[1].summary).toBe("[بحث ويب] خطأ: max_uses_exceeded");
  });

  it("compacts old search turns to source lists and trims recent results when the transcript is too large", () => {
    const head: LlmMessage = { role: "user", content: [{ type: "text", text: "سياق المهمة" }] };
    const messages: LlmMessage[] = [head];
    for (let i = 0; i < 8; i++) {
      messages.push(searchTurn(`srvtoolu_${i}`, `query ${i}`, 10, 3000));
      messages.push({ role: "user", content: [{ type: "tool_result", toolUseId: `t${i}`, content: "ok" }] });
    }
    const before = sizeOf(messages);
    // Half the size: compacting the old turns (5 of 8 search turns) is enough; the recent ones stay verbatim.
    const compacted = compactTranscript(messages, Math.floor(before / 2));
    expect(sizeOf(compacted)).toBeLessThanOrEqual(before / 2);
    // Task context survives, old search turns became text summaries with their URLs.
    expect(compacted[0]).toEqual(head);
    const oldTexts = compacted.flatMap((m) => m.content).filter((b) => b.type === "text" && b.text.includes("نتائج بحث سابقة"));
    expect(oldTexts.length).toBeGreaterThan(0);
    expect((oldTexts[0] as { text: string }).text).toContain("https://example.com/");
    // No orphaned raw result without its server_tool_use.
    for (const m of compacted) {
      const kinds = m.content.filter((b) => b.type === "raw").map((b) => (b as { kind: string }).kind);
      expect(kinds.includes("web_search_tool_result")).toBe(kinds.includes("server_tool_use"));
    }
    // Aggressive limit: recent results trimmed to their first hits, still valid pairs.
    const tight = compactTranscript(messages, 40_000);
    const recentRaw = tight.flatMap((m) => m.content).filter((b) => b.type === "raw" && b.kind === "web_search_tool_result") as { block: { content: unknown[] } }[];
    expect(recentRaw.every((b) => b.block.content.length <= 5)).toBe(true);
  });
});

describe("anthropic provider resilience", () => {
  it("retries once without the web_search tool when the API rejects its configuration, and reports it", async () => {
    const calls: { tools?: { type?: string; name?: string }[] }[] = [];
    const client = {
      messages: {
        async create(params: { tools?: { type?: string; name?: string }[] }) {
          calls.push(params);
          if (calls.length === 1) {
            throw Object.assign(new Error("400 invalid_request_error"), { status: 400, error: { error: { type: "invalid_request_error", message: "tools.3.web_search_20260209: Country code OM is not supported." } } });
          }
          return { id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: "حسناً" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } };
        },
      },
    };
    const provider = await createAnthropicProvider("test-key", { client: client as never });
    const request = { model: "claude-sonnet-5", systemPrompt: "s", companyContext: "c", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }], tools: [{ name: "get_kpis", description: "d", inputSchema: { type: "object", properties: {} } }], maxTokens: 50, webSearch: true, webSearchMaxUses: 8 };
    const response = await provider.complete(request);
    expect(calls).toHaveLength(2);
    expect(calls[0].tools?.some((t) => t.name === "web_search")).toBe(true);
    expect(calls[1].tools?.some((t) => t.name === "web_search")).toBe(false);
    expect(response.notes?.[0]).toMatch(/web_search_unavailable: .*Country code OM/);
    expect(response.content).toEqual([{ type: "text", text: "حسناً" }]);

    // Any other error still propagates untouched.
    const failing = { messages: { async create() { throw Object.assign(new Error("overloaded"), { status: 529 }); } } };
    const p2 = await createAnthropicProvider("test-key", { client: failing as never });
    await expect(p2.complete(request)).rejects.toThrow(/overloaded/);
  });
});

describe("agent loop after the search budget is exhausted", () => {
  it("nudges the model once with a fresh budget instead of accepting the failure as the final answer", async () => {
    const { t, ownerId } = await setup();
    // Created without the chat's automatic scheduling so exactly one loop runs (deterministic call count).
    const taskId = await t.run(async (ctx) => createTask(ctx, { title: "بحث", request: "ابحث عن أسعار فنادق نزوى [[search_limit]]", origin: "owner", agentSlug: "product", requestedBy: { type: "owner", id: ownerId } }));
    await t.action(internal.agents.loop.run, { taskId });
    const task = (await t.run(async (ctx) => ctx.db.get(taskId)))!;
    expect(task.status).toBe("COMPLETED");
    const transcript = task.transcript as LlmMessage[];
    const nudge = transcript.find((m) => m.role === "user" && m.content.some((b) => b.type === "text" && b.text.includes("تجاوز حد عمليات البحث")));
    expect(nudge).toBeTruthy();
    const runs = await t.run(async (ctx) => ctx.db.query("taskRuns").withIndex("by_task", (q) => q.eq("taskId", taskId)).take(50));
    expect(runs.filter((r) => r.kind === "MODEL_CALL")).toHaveLength(2);
    expect(runs.some((r) => r.kind === "NOTE" && r.note?.includes("بحث ويب: 1 استعلام"))).toBe(true);
    // The final answer came from the second call, not the "search failed" text.
    expect(task.result).toContain("ملخص");
  });
});
