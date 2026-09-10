/**
 * Owner ↔ executive agent conversation. Sending a message creates a task for
 * the executive agent; the UI subscribes to the task tree and run steps to
 * watch the work being distributed live.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { ownerActor, requireUser } from "./lib/actor";
import { appError } from "./lib/errors";
import { scheduleRun } from "./agents/runtime";
import { collectDescendants, createTask, requestCancel } from "./services/tasks";

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db.query("conversations").withIndex("by_owner", (q) => q.eq("ownerUserId", user._id)).order("desc").take(50);
    return rows.filter((c) => !c.archivedAt);
  },
});

export const getConversation = query({
  args: { conversationId: v.optional(v.id("conversations")) },
  handler: async (ctx, { conversationId }) => {
    const user = await requireUser(ctx);
    if (!conversationId) return null;
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.ownerUserId !== user._id) return null;
    const messages = await ctx.db.query("chatMessages").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(500);
    const tasks = await ctx.db.query("tasks").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).order("desc").take(100);
    const activeTask = conversation.activeTaskId ? await ctx.db.get(conversation.activeTaskId) : null;
    const activeTree = activeTask ? [activeTask, ...(await collectDescendants(ctx, activeTask._id))] : [];
    const runs = activeTree.length
      ? (await Promise.all(activeTree.map((t) => ctx.db.query("taskRuns").withIndex("by_task", (q) => q.eq("taskId", t._id)).take(100)))).flat()
      : [];
    return { conversation, messages, tasks, activeTask, activeTree, runs: runs.sort((a, b) => a.createdAt - b.createdAt) };
  },
});

export const send = mutation({
  args: { conversationId: v.optional(v.id("conversations")), message: v.string(), premiumRequested: v.optional(v.boolean()) },
  returns: v.object({ conversationId: v.id("conversations"), taskId: v.id("tasks") }),
  handler: async (ctx, { conversationId, message, premiumRequested }) => {
    const user = await requireUser(ctx);
    const text = message.trim();
    if (!text) throw appError("VALIDATION", "message: الرسالة فارغة", { field: "message" });
    const now = Date.now();
    let convId = conversationId;
    if (convId) {
      const existing = await ctx.db.get(convId);
      if (!existing || existing.ownerUserId !== user._id) throw appError("NOT_FOUND", "المحادثة غير موجودة");
      if (existing.activeTaskId) {
        const active = await ctx.db.get(existing.activeTaskId);
        if (active && ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS", "CANCELLING"].includes(active.status)) {
          throw appError("CONFLICT", "توجد مهمة جارية في هذه المحادثة؛ أوقفها أو انتظر اكتمالها");
        }
      }
    } else {
      convId = await ctx.db.insert("conversations", { ownerUserId: user._id, title: text.slice(0, 60), lastMessageAt: now, createdAt: now });
    }
    await ctx.db.insert("chatMessages", { conversationId: convId, role: "owner", content: text, status: "DONE", partial: false, createdAt: now });
    const taskId = await createTask(ctx, {
      title: text.slice(0, 80),
      request: text,
      origin: "owner",
      agentSlug: "executive",
      requestedBy: ownerActor(user),
      conversationId: convId,
      priority: "NORMAL",
    });
    if (premiumRequested) await ctx.db.patch(taskId, { premiumRequested: true });
    await ctx.db.insert("chatMessages", { conversationId: convId, role: "assistant", content: "", taskId, status: "PENDING", partial: false, createdAt: now + 1 });
    await ctx.db.patch(convId, { activeTaskId: taskId, lastMessageAt: now });
    await scheduleRun(ctx, taskId);
    return { conversationId: convId, taskId };
  },
});

/** The "إيقاف العمل" button: stops the task and every subtask within one poll interval. */
export const stop = mutation({
  args: { taskId: v.id("tasks"), reason: v.optional(v.string()) },
  handler: async (ctx, { taskId, reason }) => {
    const user = await requireUser(ctx);
    return await requestCancel(ctx, ownerActor(user), taskId, reason?.trim() || "أوقفه المالك من المحادثة");
  },
});

/** "استكمال": a new task continues from the saved partial output. */
export const resume = mutation({
  args: { taskId: v.id("tasks") },
  returns: v.id("tasks"),
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) throw appError("NOT_FOUND", "المهمة غير موجودة");
    if (!["CANCELLED", "FAILED", "BUDGET_EXCEEDED"].includes(task.status)) throw appError("CONFLICT", "لا يمكن استكمال مهمة غير متوقفة");
    const now = Date.now();
    const request = `${task.request}\n\n---\nهذه استكمال لمهمة أُوقفت سابقاً (${task.businessId}). ما أُنجز جزئياً:\n${task.partialResult ?? "(لا ناتج جزئي)"}\n\nاستكمل من حيث توقف العمل دون تكرار ما أُنجز.`;
    const newId = await createTask(ctx, {
      title: `استكمال: ${task.title}`.slice(0, 80),
      request,
      origin: task.origin,
      agentSlug: task.agentSlug,
      requestedBy: ownerActor(user),
      conversationId: task.conversationId,
      priority: task.priority,
      contextRefs: task.contextRefs,
      feedback: task.feedback,
      resumedFromTaskId: task._id,
    });
    if (task.conversationId) {
      await ctx.db.insert("chatMessages", { conversationId: task.conversationId, role: "system", content: `طلب المالك استكمال المهمة ${task.businessId}.`, status: "DONE", partial: false, createdAt: now });
      await ctx.db.insert("chatMessages", { conversationId: task.conversationId, role: "assistant", content: "", taskId: newId, status: "PENDING", partial: false, createdAt: now + 1 });
      await ctx.db.patch(task.conversationId, { activeTaskId: newId, lastMessageAt: now });
    }
    // Hide the resume/dismiss controls of the old message.
    await acknowledge(ctx, taskId);
    await scheduleRun(ctx, newId);
    return newId;
  },
});

async function acknowledge(ctx: MutationCtx, taskId: Id<"tasks">) {
  const task = await ctx.db.get(taskId);
  if (!task?.conversationId) return;
  const messages = await ctx.db.query("chatMessages").withIndex("by_conversation", (q) => q.eq("conversationId", task.conversationId!)).take(500);
  const mine = messages.find((m) => m.taskId === taskId && m.role === "assistant");
  if (mine) await ctx.db.patch(mine._id, { partial: false });
}

/** "تجاهل": keep the partial output as history without continuing. */
export const dismiss = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    await requireUser(ctx);
    await acknowledge(ctx, taskId);
    return null;
  },
});
