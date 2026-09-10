/**
 * Content calendar and unified inbox read models for the owner UI.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/actor";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return (await ctx.db.query("contentCalendar").order("desc").take(200)).filter((c) => !c.archivedAt);
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
      out.push({ ...r, customerName: customer?.fullName ?? null, customerBusinessId: customer?.businessId ?? null });
    }
    return out;
  },
});
