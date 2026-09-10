/**
 * Sales pipeline operations beyond generic CRUD.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireUser } from "./lib/actor";
import { changeLeadStage, createQuoteDraft } from "./services/commercial";
import type { LeadStage } from "./lib/vocab";

export const pipeline = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const leads = (await ctx.db.query("leads").order("desc").take(500)).filter((l) => !l.archivedAt);
    const quotes = (await ctx.db.query("quotes").order("desc").take(300)).filter((q) => !q.archivedAt);
    return { leads, quotes };
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
