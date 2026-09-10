/**
 * Post-sale follow-ups API: the daily cron entry point and the owner's view.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { runScheduledJob } from "./services/scheduled";
// appendAudit is still used by `skip` below.

/** Kept for compatibility; the cron now goes through `scheduled.run` which honours the owner's switch. */
export const daily = internalMutation({
  args: {},
  handler: async (ctx) => await runScheduledJob(ctx, "lifecycleFollowUps"),
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("followUps").order("desc").take(limit ?? 200);
    const out = [];
    for (const r of rows) {
      const booking = await ctx.db.get(r.bookingId);
      const customer = await ctx.db.get(r.customerId);
      out.push({ ...r, bookingBusinessId: booking?.businessId ?? null, travelDateFrom: booking?.travelDateFrom ?? null, customerName: customer?.fullName ?? null });
    }
    return out;
  },
});

/** Owner triggers the planner immediately (same code path as the cron). */
export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    return (await runScheduledJob(ctx, "lifecycleFollowUps", { actor: ownerActor(user), force: true })) as { scheduled: number; proposed: number; skipped: number; cancelled: number };
  },
});

export const skip = mutation({
  args: { followUpId: v.id("followUps"), reason: v.string() },
  handler: async (ctx, { followUpId, reason }) => {
    const user = await requireOwner(ctx);
    const followUp = await ctx.db.get(followUpId);
    if (!followUp) throw appError("NOT_FOUND", "المتابعة غير موجودة");
    if (followUp.status === "SENT") throw appError("CONFLICT", "أُرسلت هذه المتابعة بالفعل");
    if (!reason.trim()) throw appError("VALIDATION", "reason: السبب إلزامي", { field: "reason" });
    await ctx.db.patch(followUpId, { status: "SKIPPED", skipReason: reason.trim(), updatedAt: Date.now() });
    if (followUp.approvalId) {
      const approval = await ctx.db.get(followUp.approvalId);
      if (approval && approval.status === "PENDING") await ctx.db.patch(approval._id, { status: "CANCELLED", decidedAt: Date.now(), decidedBy: ownerActor(user), decisionReason: reason.trim() });
    }
    await appendAudit(ctx, { actor: ownerActor(user), table: "followUps", recordId: followUpId, businessId: followUp.businessId, event: "UPDATE", oldValue: { status: followUp.status }, newValue: { status: "SKIPPED" }, reason, severity: "D1", approvalId: followUp.approvalId });
    return null;
  },
});
