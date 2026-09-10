/**
 * Sales pipeline operations for the owner UI: stage changes, quotes (create and
 * send), messages to leads, pipeline report.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireUser } from "./lib/actor";
import type { LeadStage } from "./lib/vocab";
import { changeLeadStage, createQuoteDraft } from "./services/commercial";
import { pipelineReport } from "./services/reports";
import { logInteraction, sendQuoteByOwner } from "./services/sales";

export const pipeline = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const leads = (await ctx.db.query("leads").order("desc").take(500)).filter((l) => !l.archivedAt);
    const quotes = (await ctx.db.query("quotes").order("desc").take(300)).filter((q) => !q.archivedAt);
    return { leads, quotes };
  },
});

export const report = query({
  args: { staleDays: v.optional(v.number()) },
  handler: async (ctx, { staleDays }) => {
    await requireUser(ctx);
    return await pipelineReport(ctx, { staleDays });
  },
});

export const get = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(leadId);
    if (!lead) return null;
    const customer = lead.customerId ? await ctx.db.get(lead.customerId) : null;
    const quotes = await ctx.db.query("quotes").withIndex("by_lead", (q) => q.eq("leadId", leadId)).order("desc").take(20);
    const interactions = (await ctx.db.query("interactions").withIndex("by_receivedAt").order("desc").take(500)).filter((i) => i.leadId === leadId || (lead.customerId && i.customerId === lead.customerId)).slice(0, 50);
    const approvals = (await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "PENDING")).take(200)).filter((a) => a.targetRecordId === leadId || quotes.some((q) => a.targetRecordId === q._id));
    const product = lead.interestedProductId ? await ctx.db.get(lead.interestedProductId) : null;
    const activeProducts = (await ctx.db.query("products").withIndex("by_status", (q) => q.eq("status", "ACTIVE")).take(100)).map((p) => ({ _id: p._id, businessId: p.businessId, name: p.name, version: p.version, customerSellingPrice: p.pricing.customerSellingPrice }));
    return { lead, customer, quotes, interactions, approvals, product, activeProducts };
  },
});

export const changeStage = mutation({
  args: { leadId: v.id("leads"), stage: v.string(), lostReason: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { leadId, stage, lostReason, note }) => {
    const user = await requireUser(ctx);
    await changeLeadStage(ctx, ownerActor(user), leadId, stage as LeadStage, { lostReason, note });
    return null;
  },
});

export const createQuote = mutation({
  args: { leadId: v.id("leads"), productId: v.id("products"), pax: v.number(), discountPercent: v.optional(v.number()), validDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await createQuoteDraft(ctx, ownerActor(user), args);
  },
});

/** Owner sends a quote directly (mock delivery until channels are connected). */
export const sendQuote = mutation({
  args: { quoteId: v.id("quotes"), channel: v.string(), message: v.string() },
  handler: async (ctx, { quoteId, channel, message }) => {
    const user = await requireUser(ctx);
    const { quote } = await sendQuoteByOwner(ctx, ownerActor(user), quoteId, channel as Doc<"interactions">["channel"], message);
    return { businessId: quote.businessId };
  },
});

/** Owner logs a message (inbound note or an outbound message already sent) against a lead or customer. */
export const logMessage = mutation({
  args: {
    leadId: v.optional(v.id("leads")),
    customerId: v.optional(v.id("customers")),
    channel: v.string(),
    direction: v.string(),
    kind: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await logInteraction(ctx, ownerActor(user), {
      leadId: args.leadId,
      customerId: args.customerId,
      channel: args.channel as Doc<"interactions">["channel"],
      direction: args.direction as Doc<"interactions">["direction"],
      kind: args.kind as Doc<"interactions">["kind"] | undefined,
      body: args.body,
    });
  },
});
