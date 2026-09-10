/**
 * Content calendar, campaigns and unified-inbox read models for the owner UI.
 * Owner actions here are direct (the owner is the approver); agent proposals
 * still go through the approval inbox.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { getSetting } from "./lib/settings";
import { createCampaign, scheduleContent, setCampaignStatus, setContentStatus } from "./services/sales";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return (await ctx.db.query("contentCalendar").order("desc").take(300)).filter((c) => !c.archivedAt);
  },
});

export const campaigns = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return (await ctx.db.query("campaigns").order("desc").take(100)).filter((c) => !c.archivedAt);
  },
});

export const createCampaignByOwner = mutation({
  args: {
    name: v.string(),
    objective: v.string(),
    platforms: v.array(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    targetAudience: v.optional(v.string()),
    budgetOmr: v.optional(v.number()),
    productIds: v.optional(v.array(v.id("products"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await createCampaign(ctx, ownerActor(user), {
      name: args.name,
      objective: args.objective,
      platforms: args.platforms as Doc<"campaigns">["platforms"],
      startDate: args.startDate,
      endDate: args.endDate,
      targetAudience: args.targetAudience,
      budget: args.budgetOmr !== undefined ? { amount: args.budgetOmr, currency: "OMR" } : undefined,
      productIds: args.productIds,
    });
  },
});

export const updateCampaignStatus = mutation({
  args: { campaignId: v.id("campaigns"), status: v.string() },
  handler: async (ctx, { campaignId, status }) => {
    const user = await requireOwner(ctx);
    await setCampaignStatus(ctx, ownerActor(user), campaignId, status as Doc<"campaigns">["status"]);
    return null;
  },
});

export const createContentByOwner = mutation({
  args: {
    platform: v.string(),
    caption: v.string(),
    captionEn: v.optional(v.string()),
    hashtags: v.optional(v.array(v.string())),
    visualIdea: v.optional(v.string()),
    scheduledAt: v.number(),
    productId: v.optional(v.id("products")),
    campaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await scheduleContent(ctx, ownerActor(user), "sales", { ...args, platform: args.platform as Doc<"contentCalendar">["platform"] });
  },
});

export const updateContentStatus = mutation({
  args: { contentId: v.id("contentCalendar"), status: v.string(), reason: v.optional(v.string()), caption: v.optional(v.string()) },
  handler: async (ctx, { contentId, status, reason, caption }) => {
    const user = await requireOwner(ctx);
    const integrations = await getSetting(ctx, "integrations");
    await setContentStatus(ctx, ownerActor(user), contentId, status as Doc<"contentCalendar">["status"], { reason, caption, mode: integrations.instagramMode });
    return null;
  },
});

export const inbox = query({
  args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { status, limit }) => {
    await requireUser(ctx);
    const rows = status
      ? await ctx.db.query("interactions").withIndex("by_status", (q) => q.eq("status", status as never)).order("desc").take(limit ?? 100)
      : await ctx.db.query("interactions").withIndex("by_receivedAt").order("desc").take(limit ?? 100);
    const out = [];
    for (const r of rows) {
      const customer = r.customerId ? await ctx.db.get(r.customerId) : null;
      const lead = r.leadId ? await ctx.db.get(r.leadId) : null;
      out.push({ ...r, customerName: customer?.fullName ?? lead?.contactName ?? null, customerBusinessId: customer?.businessId ?? null, leadBusinessId: lead?.businessId ?? null });
    }
    return out;
  },
});
