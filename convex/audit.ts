/**
 * Read-only access to the audit log. There is deliberately no mutation here.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/actor";

export const forRecord = query({
  args: { table: v.string(), recordId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { table, recordId, limit }) => {
    await requireUser(ctx);
    return await ctx.db.query("auditLog").withIndex("by_table_record", (q) => q.eq("table", table).eq("recordId", recordId)).order("desc").take(limit ?? 100);
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()), event: v.optional(v.string()) },
  handler: async (ctx, { limit, event }) => {
    await requireUser(ctx);
    if (event) return await ctx.db.query("auditLog").withIndex("by_event", (q) => q.eq("event", event as never)).order("desc").take(limit ?? 100);
    return await ctx.db.query("auditLog").withIndex("by_at").order("desc").take(limit ?? 100);
  },
});
