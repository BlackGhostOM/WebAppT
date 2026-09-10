/**
 * Task board (kanban), task details, cancellation, retry and the emergency stop.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { scheduleRun } from "./agents/runtime";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { appError } from "./lib/errors";
import { getSetting } from "./lib/settings";
import { collectDescendants, emergencyResume, emergencyStop, requestCancel } from "./services/tasks";

export const board = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const tasks = await ctx.db.query("tasks").order("desc").take(300);
    const agents = await ctx.db.query("agents").take(10);
    const stop = await getSetting(ctx, "emergencyStop");
    return { tasks, agents: agents.map((a) => ({ slug: a.slug, name: a.name, enabled: a.enabled })), emergencyStop: stop };
  },
});

export const get = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    await requireUser(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    const runs = await ctx.db.query("taskRuns").withIndex("by_task", (q) => q.eq("taskId", taskId)).take(500);
    const children = await collectDescendants(ctx, taskId);
    const approvals = await ctx.db.query("approvals").withIndex("by_task", (q) => q.eq("taskId", taskId)).take(50);
    const parent = task.parentTaskId ? await ctx.db.get(task.parentTaskId) : null;
    const usage = await ctx.db.query("usageLog").withIndex("by_task", (q) => q.eq("taskId", taskId)).take(200);
    return { task, runs, children, approvals, parent, usage };
  },
});

export const requestCancelTask = mutation({
  args: { taskId: v.id("tasks"), reason: v.string() },
  handler: async (ctx, { taskId, reason }) => {
    const user = await requireUser(ctx);
    return await requestCancel(ctx, ownerActor(user), taskId, reason.trim() || "أوقفه المالك");
  },
});

export const retry = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) throw appError("NOT_FOUND", "المهمة غير موجودة");
    if (!["FAILED", "CANCELLED", "BUDGET_EXCEEDED"].includes(task.status)) throw appError("CONFLICT", "إعادة المحاولة متاحة للمهام المتوقفة فقط");
    const stop = await getSetting(ctx, "emergencyStop");
    if (stop.active) throw appError("EMERGENCY_STOP", "الإيقاف الطارئ مفعّل");
    await ctx.db.patch(taskId, { status: "QUEUED", cancelRequested: false, cancelReason: undefined, cancelledBy: undefined, error: undefined, finishedAt: undefined });
    await ctx.db.insert("taskRuns", { taskId, stepIndex: task.stepCount + 1, kind: "NOTE", note: `إعادة المحاولة بطلب ${user.email ?? user._id}`, createdAt: Date.now() });
    await ctx.db.patch(taskId, { stepCount: task.stepCount + 1 });
    await scheduleRun(ctx, taskId);
    return null;
  },
});

export const emergencyStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await getSetting(ctx, "emergencyStop");
  },
});

export const activateEmergencyStop = mutation({
  args: { reason: v.string() },
  returns: v.number(),
  handler: async (ctx, { reason }) => {
    const user = await requireOwner(ctx);
    return await emergencyStop(ctx, ownerActor(user), reason.trim() || "إيقاف طارئ من المالك");
  },
});

export const deactivateEmergencyStop = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    await emergencyResume(ctx, ownerActor(user));
    return null;
  },
});
