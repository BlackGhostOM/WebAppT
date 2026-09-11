import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { executeTool } from "../../convex/agents/tools";
import type { LlmMessage } from "../../convex/lib/llm/types";
import { createTask } from "../../convex/services/tasks";
import { type Harness, setup } from "./helpers";

async function productTask(h: Harness) {
  const agent = await h.t.run(async (ctx) => (await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", "product")).unique())!);
  const taskId = await h.t.run(async (ctx) => createTask(ctx, { title: "بحث", request: "صمّم باقة", origin: "owner", agentSlug: "product", requestedBy: { type: "owner", id: h.ownerId } }));
  const task = (await h.t.run(async (ctx) => ctx.db.get(taskId)))!;
  return { agent, task };
}

describe("product agent records what it finds on the web", () => {
  it("drafts destination → supplier → hotel → research rate from an empty database, all marked AI-extracted", async () => {
    const h = await setup();
    const { agent, task } = await productTask(h);
    const run = (name: string, input: Record<string, unknown>) => h.t.run(async (ctx) => executeTool(ctx, task, agent, name, input));

    const dest = await run("create_destination", { name: "نزوى", nameEn: "Nizwa", kind: "HERITAGE", governorate: "الداخلية", bestSeasons: ["WINTER"] });
    expect(dest.isError).toBeFalsy();
    const destinationId = /معرّف (\S+)\)/.exec(dest.content)![1];
    const destination = (await h.t.run(async (ctx) => ctx.db.get(destinationId as Id<"destinations">)))!;
    expect(destination).toMatchObject({ name: "نزوى", status: "ACTIVE", trustLevel: "E_AI_ESTIMATE", verificationStatus: "AI_EXTRACTED" });
    expect(destination.createdBy).toMatchObject({ type: "agent", id: "product" });

    const supplier = await run("create_supplier_draft", { name: "Falaj Daris Hotel", supplierType: "HOTEL", website: "https://example.com/falaj", city: "نزوى", notes: "مستخرج من صفحة الحجز" });
    const supplierId = /معرّف (\S+)\)/.exec(supplier.content)![1];
    expect((await h.t.run(async (ctx) => ctx.db.get(supplierId as Id<"suppliers">)))?.status).toBe("PROSPECT");

    const hotel = await run("create_hotel_draft", { name: "Falaj Daris Hotel", destinationId, supplierId, category: "THREE_STAR", website: "https://example.com/falaj" });
    expect(hotel.isError).toBeFalsy();
    const hotelId = /معرّف (\S+)\)/.exec(hotel.content)![1];
    expect((await h.t.run(async (ctx) => ctx.db.get(hotelId as Id<"hotels">)))).toMatchObject({ status: "DRAFT", destinationId, supplierId });

    const rate = await run("create_research_rate", { supplierId, hotelId, componentType: "HOTEL", serviceType: "HOTEL_ROOM", serviceDescription: "غرفة عائلية", rateBasis: "PER_NIGHT", amount: 45, currency: "OMR", season: "WINTER", sourceUrl: "https://example.com/falaj/rooms" });
    expect(rate.isError).toBeFalsy();
    const rates = await h.t.run(async (ctx) => ctx.db.query("rates").take(5));
    expect(rates[0]).toMatchObject({ rateTrust: "ESTIMATED", trustLevel: "E_AI_ESTIMATE", supplierId, hotelId });

    // A hotel without a real destination id is refused with guidance, not silently created.
    const bad = await run("create_hotel_draft", { name: "X", destinationId: "nope", category: "UNRATED" });
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/create_destination/);
  });

  it("returns duplicate candidates instead of forking reference data", async () => {
    const h = await setup();
    const { agent, task } = await productTask(h);
    const run = (name: string, input: Record<string, unknown>) => h.t.run(async (ctx) => executeTool(ctx, task, agent, name, input));
    const first = await run("create_supplier_draft", { name: "Oman Desert Camp", supplierType: "ACTIVITY_OPERATOR", phone: "+968 99000777" });
    const firstId = /معرّف (\S+)\)/.exec(first.content)![1];
    const again = await run("create_supplier_draft", { name: "Oman Desert Camp", supplierType: "ACTIVITY_OPERATOR", phone: "+968 99000777" });
    expect(again.isError).toBeFalsy();
    expect(again.content).toContain("سجلات مشابهة");
    expect(again.content).toContain(firstId);
    expect(await h.t.run(async (ctx) => (await ctx.db.query("suppliers").take(10)).length)).toBe(1);
    const forced = await run("create_supplier_draft", { name: "Oman Desert Camp", supplierType: "ACTIVITY_OPERATOR", phone: "+968 99000777", acknowledgeDuplicates: true });
    expect(forced.content).toContain("أُنشئ");
    // Other agents cannot use these tools.
    const sales = await h.t.run(async (ctx) => (await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", "sales")).unique())!);
    const denied = await h.t.run(async (ctx) => executeTool(ctx, task, sales, "create_supplier_draft", { name: "x", supplierType: "HOTEL" }));
    expect(denied.isError).toBe(true);
  });
});

describe("agent loop never reports a cut-off or empty reply as a finished task", () => {
  it("continues after max_tokens and finishes with the model's follow-up", async () => {
    const h = await setup();
    const taskId = await h.t.run(async (ctx) => createTask(ctx, { title: "باقة", request: "صمّم باقة الداخلية [[max_tokens]]", origin: "owner", agentSlug: "product", requestedBy: { type: "owner", id: h.ownerId } }));
    await h.t.action(internal.agents.loop.run, { taskId });
    const task = (await h.t.run(async (ctx) => ctx.db.get(taskId))) as Doc<"tasks">;
    expect(task.status).toBe("COMPLETED");
    const transcript = task.transcript as LlmMessage[];
    expect(transcript.some((m) => m.role === "user" && m.content.some((b) => b.type === "text" && b.text.includes("بلغ حد الطول")))).toBe(true);
    const calls = await h.t.run(async (ctx) => (await ctx.db.query("taskRuns").withIndex("by_task", (q) => q.eq("taskId", taskId)).take(50)).filter((r) => r.kind === "MODEL_CALL"));
    expect(calls).toHaveLength(2);
    expect(calls[0].note).toContain("stop_reason=max_tokens");
    // The truncated fragment is kept as partial context and the final result is the follow-up summary.
    expect(task.result).toContain("ملخص");
  });

  it("asks once for a summary when the model ends its turn with no text", async () => {
    const h = await setup();
    const taskId = await h.t.run(async (ctx) => createTask(ctx, { title: "فارغ", request: "ابحث [[empty]]", origin: "owner", agentSlug: "product", requestedBy: { type: "owner", id: h.ownerId } }));
    await h.t.action(internal.agents.loop.run, { taskId });
    const task = (await h.t.run(async (ctx) => ctx.db.get(taskId)))!;
    expect(task.status).toBe("COMPLETED");
    expect(task.result).not.toBe("(لا ناتج نصي)");
    expect(task.result).toContain("ملخص");
    const calls = await h.t.run(async (ctx) => (await ctx.db.query("taskRuns").withIndex("by_task", (q) => q.eq("taskId", taskId)).take(50)).filter((r) => r.kind === "MODEL_CALL"));
    expect(calls).toHaveLength(2);
  });
});
