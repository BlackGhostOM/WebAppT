import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { executeTool } from "../../convex/agents/tools";
import { fromAnthropicContent } from "../../convex/lib/llm/anthropic";
import { computeCostUsd } from "../../convex/lib/llm/pricing";
import { activateProduct, addProductComponent, createQuoteDraft, createResearchRate, productCosting } from "../../convex/services/commercial";
import { createRecord, updateRecord } from "../../convex/services/records";
import { pipelineReport } from "../../convex/services/reports";
import { AGENT, type Harness, OWNER_ACTOR, setup } from "./helpers";

async function seedSupplierAndDestination(h: Harness) {
  const owner = OWNER_ACTOR(h.ownerId);
  const supplier = await h.t.run(async (ctx) => createRecord(ctx, owner, "suppliers", { name: "فندق الاختبار", supplierType: "HOTEL", status: "APPROVED" }));
  const destination = await h.t.run(async (ctx) => createRecord(ctx, owner, "destinations", { name: "مسقط", nameEn: "Muscat", kind: "CITY" }));
  return { supplier, destination };
}

/** Minimal task + agent docs so tools can be executed the way the loop does. */
async function agentTask(h: Harness, slug: "product" | "sales", refs: Partial<Doc<"tasks">["contextRefs"]> = {}) {
  const agent = await h.t.run(async (ctx) => (await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique())!);
  const taskId = await h.t.run(async (ctx) =>
    ctx.db.insert("tasks", {
      businessId: `TSK-TEST-${slug}`,
      title: "test",
      request: "test",
      origin: "owner",
      requestedBy: { type: "owner", id: h.ownerId },
      agentSlug: slug,
      status: "RUNNING",
      priority: "NORMAL",
      cancelRequested: false,
      stepCount: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      contextRefs: { customerIds: [], leadIds: [], productIds: [], bookingIds: [], ...refs },
      citations: [],
      feedback: [],
    }),
  );
  const task = await h.t.run(async (ctx) => (await ctx.db.get(taskId))!);
  return { agent, task };
}

describe("Phase 2 — product agent: research, drafting, activation via approval", () => {
  it("walks a product from draft to ACTIVE only through the owner's approval", async () => {
    const h = await setup();
    const { supplier, destination } = await seedSupplierAndDestination(h);
    const product = AGENT("product");

    // The agent drafts and prices with a research (ESTIMATED) rate.
    const draft = await h.t.run(async (ctx) =>
      createRecord(ctx, product, "products", { name: "كنوز مسقط", productType: "PACKAGE", status: "DESIGN", durationDays: 3, durationNights: 2, summary: "اختبار", destinationIds: [destination.id], customerSellingPrice: { amount: 200, currency: "OMR" } }),
    );
    const rate = await h.t.run(async (ctx) =>
      createResearchRate(ctx, product, { supplierId: supplier.id as Id<"suppliers">, componentType: "HOTEL", serviceType: "HOTEL_ROOM", serviceDescription: "غرفة", rateBasis: "PER_NIGHT", amount: 60, currency: "OMR", season: "WINTER", sourceUrl: "https://example-booking.com/x" }),
    );
    await h.t.run(async (ctx) => addProductComponent(ctx, product, draft.id as Id<"products">, { componentType: "HOTEL", description: "ليلتان", quantity: 2, unit: "PER_NIGHT", supplierId: supplier.id as Id<"suppliers">, rateId: rate.id, customerSellingPrice: { amount: 160, currency: "OMR" } }));
    const costing = await h.t.run(async (ctx) => productCosting(ctx, draft.id as Id<"products">));
    expect(costing.estimatedComponents).toBe(1);
    expect(costing.margin.totalCostBase).toBe(120);

    // Lifecycle moves are allowed for the agent…
    for (const status of ["COSTING", "QA", "APPROVAL", "READY_FOR_SALE"]) {
      const r = await h.t.run(async (ctx) => updateRecord(ctx, product, "products", draft.id, { status }));
      expect(r.approvalRequired).toBeFalsy();
    }
    // …but activation is a D3 change: it becomes an approval, not an ACTIVE product.
    const outcome = await h.t.run(async (ctx) => activateProduct(ctx, product, draft.id as Id<"products">));
    expect(outcome.approvalRequired).toBe(true);
    let doc = await h.t.run(async (ctx) => ctx.db.get(draft.id as Id<"products">));
    expect(doc?.status).toBe("READY_FOR_SALE");

    await h.asOwner.mutation(api.approvals.decide, { approvalId: outcome.approvalId!, decision: "APPROVED" });
    await h.t.action(internal.approvals.execute, { approvalId: outcome.approvalId! });
    doc = await h.t.run(async (ctx) => ctx.db.get(draft.id as Id<"products">));
    expect(doc?.status).toBe("ACTIVE");
    expect(doc?.approvedBy?.type).toBe("owner");
  });

  it("exposes itinerary and costing tools to the product agent and blocks activation before READY_FOR_SALE", async () => {
    const h = await setup();
    const { destination } = await seedSupplierAndDestination(h);
    const { agent, task } = await agentTask(h, "product");
    const created = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "create_product_draft", { name: "باقة الجبل", productType: "MULTI_DAY_TOUR", durationDays: 2, durationNights: 1, summary: "اختبار", destinationIds: [destination.id] }));
    expect(created.isError).toBeFalsy();
    const productId = (await h.t.run(async (ctx) => (await ctx.db.query("products").take(10))[0]._id)) as Id<"products">;

    const day = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "upsert_itinerary_day", { productId, dayNumber: 1, title: "نزوى", description: "القلعة والسوق", breakfast: true }));
    expect(day.isError).toBeFalsy();
    const badDay = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "upsert_itinerary_day", { productId, dayNumber: 5, title: "x", description: "y" }));
    expect(badDay.isError).toBe(true);

    const early = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "request_product_activation", { productId }));
    expect(early.isError).toBe(true);
    expect(early.content).toMatch(/READY_FOR_SALE/);

    const costing = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "get_product_costing", { productId }));
    expect(JSON.parse(costing.content).itinerary).toHaveLength(1);
  });
});

describe("Phase 2 — sales agent: quotes, follow-ups, campaigns, content", () => {
  async function activeProductAndLead(h: Harness) {
    const owner = OWNER_ACTOR(h.ownerId);
    const { supplier } = await seedSupplierAndDestination(h);
    const product = await h.t.run(async (ctx) =>
      createRecord(ctx, owner, "products", { name: "كنوز مسقط", productType: "PACKAGE", status: "READY_FOR_SALE", durationDays: 3, durationNights: 2, summary: "s", supplierCost: { amount: 100, currency: "OMR" }, minSellingPrice: { amount: 130, currency: "OMR" }, customerSellingPrice: { amount: 150, currency: "OMR" } }),
    );
    const rate = await h.t.run(async (ctx) => createResearchRate(ctx, AGENT("product"), { supplierId: supplier.id as Id<"suppliers">, componentType: "HOTEL", serviceType: "HOTEL_ROOM", serviceDescription: "غرفة", rateBasis: "PER_NIGHT", amount: 50, currency: "OMR", season: "WINTER", sourceUrl: "https://example.com/r" }));
    await h.t.run(async (ctx) => addProductComponent(ctx, owner, product.id as Id<"products">, { componentType: "HOTEL", description: "ليلتان", quantity: 2, unit: "PER_NIGHT", rateId: rate.id, supplierCost: { amount: 100, currency: "OMR" }, customerSellingPrice: { amount: 150, currency: "OMR" } }));
    await h.t.run(async (ctx) => activateProduct(ctx, owner, product.id as Id<"products">));
    const customer = await h.t.run(async (ctx) => createRecord(ctx, owner, "customers", { fullName: "سعيد", customerType: "FAMILY", preferredLanguage: "ar", consentStatus: "GRANTED", phone: "+968 99000001" }));
    const lead = await h.t.run(async (ctx) => createRecord(ctx, owner, "leads", { contactName: "سعيد", channel: "WHATSAPP", stage: "QUALIFIED", customerId: customer.id, contactPhone: "+968 99000001" }));
    return { productId: product.id as Id<"products">, leadId: lead.id as Id<"leads">, customerId: customer.id as Id<"customers"> };
  }

  it("builds quotes only from ACTIVE products, flags ESTIMATED rates, and sends only after approval", async () => {
    const h = await setup();
    const { productId, leadId } = await activeProductAndLead(h);
    const sales = AGENT("sales");
    const inactive = await h.t.run(async (ctx) => createRecord(ctx, OWNER_ACTOR(h.ownerId), "products", { name: "مسودة", productType: "PACKAGE", status: "DESIGN", durationDays: 1, durationNights: 0, summary: "s", customerSellingPrice: { amount: 10, currency: "OMR" } }));
    await expect(h.t.run(async (ctx) => createQuoteDraft(ctx, sales, { leadId, productId: inactive.id as Id<"products">, pax: 2 }))).rejects.toThrow(/ACTIVE/);

    const quote = await h.t.run(async (ctx) => createQuoteDraft(ctx, sales, { leadId, productId, pax: 2 }));
    expect(quote.warnings.some((w) => w.includes("ESTIMATED"))).toBe(true);
    expect((await h.t.run(async (ctx) => ctx.db.get(leadId)))?.stage).toBe("PROPOSAL_PREPARED");

    const { agent, task } = await agentTask(h, "sales", { leadIds: [leadId] });
    const sent = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "send_quote", { quoteId: quote.id, channel: "WHATSAPP", message: "تفضلوا العرض" }));
    expect(sent.approvalId).toBeTruthy();
    let q = await h.t.run(async (ctx) => ctx.db.get(quote.id as Id<"quotes">));
    expect(q?.status).toBe("PENDING_APPROVAL");
    const approval = await h.t.run(async (ctx) => ctx.db.get(sent.approvalId!));
    expect(approval?.severity).toBe("D4"); // warnings escalate the severity

    await h.asOwner.mutation(api.approvals.decide, { approvalId: sent.approvalId!, decision: "APPROVED" });
    await h.t.action(internal.approvals.execute, { approvalId: sent.approvalId! });
    q = await h.t.run(async (ctx) => ctx.db.get(quote.id as Id<"quotes">));
    expect(q?.status).toBe("SENT");
    const lead = await h.t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead?.stage).toBe("QUOTE_SENT");
    const outbound = await h.t.run(async (ctx) => (await ctx.db.query("interactions").take(10)).filter((i) => i.direction === "OUTBOUND" && i.leadId === leadId));
    expect(outbound).toHaveLength(1);
  });

  it("proposes follow-ups that reach the lead only after approval and records the interaction", async () => {
    const h = await setup();
    const { leadId } = await activeProductAndLead(h);
    const { agent, task } = await agentTask(h, "sales", { leadIds: [leadId] });
    const followUpAt = Date.now() + 86_400_000;
    const result = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "propose_follow_up", { leadId, channel: "WHATSAPP", message: "هل ما زلتم مهتمين برحلة الشتاء؟", purpose: "تذكير", followUpAt: new Date(followUpAt).toISOString() }));
    expect(result.approvalId).toBeTruthy();
    let lead = await h.t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead?.nextFollowUpAt).toBe(followUpAt);
    expect(await h.t.run(async (ctx) => (await ctx.db.query("interactions").take(10)).length)).toBe(0);

    await h.asOwner.mutation(api.approvals.decide, { approvalId: result.approvalId!, decision: "APPROVED" });
    await h.t.action(internal.approvals.execute, { approvalId: result.approvalId! });
    const interactions = await h.t.run(async (ctx) => ctx.db.query("interactions").take(10));
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ direction: "OUTBOUND", leadId, channel: "WHATSAPP", status: "REPLIED" });
    lead = await h.t.run(async (ctx) => ctx.db.get(leadId));
    expect(lead?.lastContactAt).toBeGreaterThan(0);
  });

  it("creates campaigns and content that publish only after the owner's approval (mock publish)", async () => {
    const h = await setup();
    const { productId } = await activeProductAndLead(h);
    const { agent, task } = await agentTask(h, "sales");
    const campaign = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "create_campaign", { name: "شتاء عُمان", objective: "حجوزات الشتاء", platforms: ["INSTAGRAM", "SNAPCHAT"], productIds: [productId] }));
    expect(campaign.isError).toBeFalsy();
    const campaignDoc = (await h.t.run(async (ctx) => ctx.db.query("campaigns").take(1)))[0];
    expect(campaignDoc.businessId).toMatch(/^CMP-/);
    expect(campaignDoc.status).toBe("DRAFT");

    const scheduled = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "schedule_content", { platform: "INSTAGRAM", caption: "ليلة تحت نجوم رمال الشرقية ✨", hashtags: ["عمان", "#رمال_الشرقية"], scheduledAt: new Date(Date.now() - 60_000).toISOString(), campaignId: campaignDoc._id }));
    expect(scheduled.approvalId).toBeTruthy();
    let content = (await h.t.run(async (ctx) => ctx.db.query("contentCalendar").take(1)))[0];
    expect(content.status).toBe("PENDING_APPROVAL");
    expect(content.hashtags).toEqual(["#عمان", "#رمال_الشرقية"]);

    await h.asOwner.mutation(api.approvals.decide, { approvalId: scheduled.approvalId!, decision: "APPROVED" });
    await h.t.action(internal.approvals.execute, { approvalId: scheduled.approvalId! });
    content = (await h.t.run(async (ctx) => ctx.db.get(content._id)))!;
    expect(content.status).toBe("PUBLISHED");
    expect(content.externalPostId).toMatch(/^mock-/);

    // A rejected proposal carries the reason back to the calendar item.
    const second = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "schedule_content", { platform: "SNAPCHAT", caption: "ثانٍ", scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }));
    await h.asOwner.mutation(api.approvals.decide, { approvalId: second.approvalId!, decision: "REJECTED", reason: "لا يطابق دليل الهوية" });
    const rejected = (await h.t.run(async (ctx) => ctx.db.query("contentCalendar").withIndex("by_status", (q) => q.eq("status", "REJECTED")).take(5)))[0];
    expect(rejected.rejectionReason).toBe("لا يطابق دليل الهوية");
  });

  it("refuses prices in content for a non-active product and lets the owner publish directly", async () => {
    const h = await setup();
    const owner = OWNER_ACTOR(h.ownerId);
    const draft = await h.t.run(async (ctx) => createRecord(ctx, owner, "products", { name: "مسودة", productType: "PACKAGE", status: "DESIGN", durationDays: 1, durationNights: 0, summary: "s" }));
    await expect(h.asOwner.mutation(api.contentApi.createContentByOwner, { platform: "INSTAGRAM", caption: "ابتداءً من 99 ريال", scheduledAt: Date.now(), productId: draft.id as Id<"products"> })).rejects.toThrow(/غير فعّال/);
    const ok = await h.asOwner.mutation(api.contentApi.createContentByOwner, { platform: "INSTAGRAM", caption: "صباح الخير من مسقط", scheduledAt: Date.now() + 3_600_000 });
    const doc = await h.t.run(async (ctx) => ctx.db.get(ok.contentId));
    expect(doc?.status).toBe("APPROVED");
    await h.asOwner.mutation(api.contentApi.updateContentStatus, { contentId: ok.contentId, status: "PUBLISHED" });
    expect((await h.t.run(async (ctx) => ctx.db.get(ok.contentId)))?.status).toBe("PUBLISHED");
    await expect(h.asStaff.mutation(api.contentApi.updateContentStatus, { contentId: ok.contentId, status: "ARCHIVED" })).rejects.toThrow(/FORBIDDEN|المالك/);
  });

  it("reports the pipeline from data: stages, stale leads, overdue follow-ups", async () => {
    const h = await setup();
    const owner = OWNER_ACTOR(h.ownerId);
    const old = Date.now() - 10 * 86_400_000;
    const l1 = await h.t.run(async (ctx) => createRecord(ctx, owner, "leads", { contactName: "أحمد", channel: "INSTAGRAM", stage: "QUALIFIED", expectedValue: { amount: 500, currency: "OMR" }, nextFollowUpAt: Date.now() - 1000 }));
    await h.t.run(async (ctx) => ctx.db.patch(l1.id as Id<"leads">, { lastContactAt: old }));
    await h.t.run(async (ctx) => createRecord(ctx, owner, "leads", { contactName: "بدر", channel: "WEBSITE", stage: "WON", expectedValue: { amount: 300, currency: "OMR" } }));
    const report = await h.t.run(async (ctx) => pipelineReport(ctx, { staleDays: 7 }));
    expect(report.byStage.find((s) => s.stage === "QUALIFIED")?.count).toBe(1);
    expect(report.totalOpenExpectedValueOmr).toBe(500);
    expect(report.staleLeads.map((l) => l.contactName)).toEqual(["أحمد"]);
    expect(report.overdueFollowUps).toHaveLength(1);
    expect(report.source.kind).toBe("db");
  });
});

describe("Phase 2 — web research provenance", () => {
  it("keeps server-side web search results as traceable sources and bills searches", () => {
    const now = 1_700_000_000_000;
    const blocks = fromAnthropicContent(
      [
        { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Muscat hotel rates December" } },
        { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example-booking.com/muscat", title: "Muscat Bay Hotel", encrypted_content: "x", page_age: "2 days" }] },
        { type: "text", text: "الفندق يعرض 95 ر.ع لليلة." },
      ] as never,
      now,
    );
    expect(blocks[0]).toEqual({ type: "text", text: "[بحث ويب] Muscat hotel rates December" });
    expect(blocks[1]).toMatchObject({ type: "web_search_result", url: "https://example-booking.com/muscat", title: "Muscat Bay Hotel", retrievedAt: now });
    expect(computeCostUsd("claude-sonnet-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 3 })).toBeCloseTo(0.03, 6);
  });
});
