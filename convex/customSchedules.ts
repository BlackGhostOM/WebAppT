/**
 * Owner-defined recurring agent tasks: CRUD, run-now, and the cron entry point.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { appError } from "./lib/errors";
import { createCustomSchedule, fireCustomSchedule, removeCustomSchedule, runDueCustomSchedules, setCustomScheduleEnabled, updateCustomSchedule } from "./services/customSchedules";

const scheduleArgs = {
  title: v.string(),
  agentSlug: v.string(),
  request: v.string(),
  priority: v.optional(v.string()),
  frequency: v.string(),
  dayOfWeek: v.optional(v.number()),
  dayOfMonth: v.optional(v.number()),
  hour: v.optional(v.number()),
  minute: v.optional(v.number()),
  runAt: v.optional(v.number()),
  enabled: v.optional(v.boolean()),
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("customSchedules").order("desc").take(100);
    const out = [];
    for (const r of rows) {
      const lastTask = r.lastTaskId ? await ctx.db.get(r.lastTaskId) : null;
      out.push({ ...r, lastTask: lastTask ? { _id: lastTask._id, businessId: lastTask.businessId, status: lastTask.status } : null });
    }
    return out;
  },
});

export const create = mutation({
  args: scheduleArgs,
  handler: async (ctx, args) => {
    const user = await requireOwner(ctx);
    return await createCustomSchedule(ctx, ownerActor(user), args);
  },
});

export const update = mutation({
  args: { id: v.id("customSchedules"), ...scheduleArgs },
  handler: async (ctx, { id, ...args }) => {
    const user = await requireOwner(ctx);
    return await updateCustomSchedule(ctx, ownerActor(user), id, args);
  },
});

export const setEnabled = mutation({
  args: { id: v.id("customSchedules"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    const user = await requireOwner(ctx);
    await setCustomScheduleEnabled(ctx, ownerActor(user), id, enabled);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("customSchedules") },
  handler: async (ctx, { id }) => {
    const user = await requireOwner(ctx);
    await removeCustomSchedule(ctx, ownerActor(user), id);
    return null;
  },
});

/** Owner starts the schedule's task immediately; the regular cadence is unchanged. */
export const runNow = mutation({
  args: { id: v.id("customSchedules") },
  handler: async (ctx, { id }) => {
    const user = await requireOwner(ctx);
    const schedule = await ctx.db.get(id);
    if (!schedule) throw appError("NOT_FOUND", "المهمة المجدولة غير موجودة");
    return await fireCustomSchedule(ctx, schedule, "manual", ownerActor(user));
  },
});

export const runDue = internalMutation({
  args: {},
  handler: async (ctx) => await runDueCustomSchedules(ctx),
});
