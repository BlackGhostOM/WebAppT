/**
 * Rate confirmation by the owner (ESTIMATED → SUPPLIER_CONFIRMED / CONTRACTED).
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { confirmRate } from "./services/commercial";

export const proposed = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("rates").withIndex("by_status", (q) => q.eq("status", "PROPOSED")).order("desc").take(100);
  },
});

export const confirm = mutation({
  args: {
    rateId: v.id("rates"),
    rateTrust: v.union(v.literal("CONTRACTED"), v.literal("SUPPLIER_CONFIRMED")),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    cancellationTerms: v.optional(v.string()),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    evidenceRef: v.optional(v.string()),
  },
  handler: async (ctx, { rateId, ...input }) => {
    const user = await requireOwner(ctx);
    await confirmRate(ctx, ownerActor(user), rateId, input);
    return null;
  },
});
