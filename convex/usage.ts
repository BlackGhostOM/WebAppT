/**
 * Cost dashboard: monthly spend per model and per agent against the budget.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/actor";
import { monthlyUsage } from "./services/usage";

export const monthly = query({
  args: { monthKey: v.optional(v.string()) },
  handler: async (ctx, { monthKey }) => {
    await requireUser(ctx);
    return await monthlyUsage(ctx, monthKey);
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    return await ctx.db.query("usageLog").order("desc").take(limit ?? 50);
  },
});
