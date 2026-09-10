/**
 * Task lifecycle services: creation, sub-tasks, run steps, cooperative
 * cancellation (cascading to descendants and pending approvals), and the
 * emergency stop switch.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { appError } from "../lib/errors";
import { nextBusinessId } from "../lib/ids";
import { getSetting, setSetting } from "../lib/settings";
import { assertTransition } from "../lib/validation";
import type { AgentSlug, TaskStatus } from "../lib/vocab";
import { TASK_TRANSITIONS } from "../lib/vocab";

export interface CreateTaskInput {
  title: string;
  request: string;
  origin: "owner" | "customer" | "system" | "agent";
  agentSlug: AgentSlug;
  requestedBy: Actor;
  parentTaskId?: Id<"tasks">;
  conversationId?: Id<"conversations">;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  contextRefs?: Doc<"tasks">["contextRefs"];
  feedback?: string[];
  resumedFromTaskId?: Id<"tasks">;
}

export async function assertNotEmergencyStopped(ctx: QueryCtx | MutationCtx) {
  const stop = await getSetting(ctx, "emergencyStop");
  if (stop.active) throw appError("EMERGENCY_STOP", "الإيقاف الطارئ مفعّل؛ لا يمكن بدء مهام جديدة حتى يعيد المالك التفعيل");
}

export async function createTask(ctx: MutationCtx, input: CreateTaskInput): Promise<Id<"tasks">> {
  await assertNotEmergencyStopped(ctx);
  const agent = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", input.agentSlug)).unique();
  if (!agent) throw appError("NOT_FOUND", `الوكيل ${input.agentSlug} غير معرّف`);
  if (!agent.enabled) throw appError("FORBIDDEN", `الوكيل ${input.agentSlug} معطّل`);

  let rootTaskId: Id<"tasks"> | undefined;
  if (input.parentTaskId) {
    const parent = await ctx.db.get(input.parentTaskId);
    if (!parent) throw appError("NOT_FOUND", "المهمة الأم غير موجودة");
    if (parent.cancelRequested || parent.status === "CANCELLED" || parent.status === "CANCELLING") {
      throw appError("CANCELLED", "المهمة الأم أُوقفت؛ لا تُنشأ مهام فرعية");
    }
    rootTaskId = parent.rootTaskId ?? parent._id;
    const runtime = await getSetting(ctx, "agentRuntime");
    const depth = await taskDepth(ctx, parent);
    if (depth + 1 > runtime.maxSubtaskDepth) throw appError("FORBIDDEN", `تجاوز العمق الأقصى للمهام الفرعية (${runtime.maxSubtaskDepth})`);
  }

  const businessId = await nextBusinessId(ctx, "tasks");
  const taskId = await ctx.db.insert("tasks", {
    businessId,
    title: input.title.slice(0, 200),
    request: input.request,
    origin: input.origin,
    requestedBy: input.requestedBy,
    agentSlug: input.agentSlug,
    parentTaskId: input.parentTaskId,
    rootTaskId,
    conversationId: input.conversationId,
    status: "QUEUED",
    priority: input.priority ?? "NORMAL",
    cancelRequested: false,
    stepCount: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    contextRefs: input.contextRefs ?? { customerIds: [], leadIds: [], productIds: [], bookingIds: [] },
    citations: [],
    feedback: input.feedback ?? [],
    resumedFromTaskId: input.resumedFromTaskId,
  });
  await appendAudit(ctx, {
    actor: input.requestedBy,
    table: "tasks",
    recordId: taskId,
    businessId,
    event: "CREATE",
    newValue: { title: input.title, agentSlug: input.agentSlug, parentTaskId: input.parentTaskId },
    severity: "D1",
    taskId,
  });
  return taskId;
}

async function taskDepth(ctx: QueryCtx | MutationCtx, task: Doc<"tasks">): Promise<number> {
  let depth = 0;
  let cursor: Doc<"tasks"> | null = task;
  while (cursor?.parentTaskId) {
    depth += 1;
    cursor = await ctx.db.get(cursor.parentTaskId);
    if (depth > 10) break;
  }
  return depth;
}

export async function setTaskStatus(ctx: MutationCtx, taskId: Id<"tasks">, status: TaskStatus, patch: Partial<Doc<"tasks">> = {}) {
  const task = await ctx.db.get(taskId);
  if (!task) throw appError("NOT_FOUND", "المهمة غير موجودة");
  assertTransition(TASK_TRANSITIONS, task.status, status, "المهمة");
  const now = Date.now();
  await ctx.db.patch(taskId, {
    status,
    ...patch,
    ...(status === "RUNNING" && !task.startedAt ? { startedAt: now } : {}),
    ...(["COMPLETED", "FAILED", "CANCELLED", "BUDGET_EXCEEDED"].includes(status) ? { finishedAt: now } : {}),
  });
}

export async function appendRunStep(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  step: Omit<Doc<"taskRuns">, "_id" | "_creationTime" | "taskId" | "stepIndex" | "createdAt">,
): Promise<number> {
  const task = await ctx.db.get(taskId);
  if (!task) throw appError("NOT_FOUND", "المهمة غير موجودة");
  const stepIndex = task.stepCount + 1;
  await ctx.db.insert("taskRuns", { ...step, taskId, stepIndex, createdAt: Date.now() });
  await ctx.db.patch(taskId, {
    stepCount: stepIndex,
    costUsd: Math.round((task.costUsd + (step.costUsd ?? 0)) * 1_000_000) / 1_000_000,
    inputTokens: task.inputTokens + (step.inputTokens ?? 0) + (step.cacheReadTokens ?? 0) + (step.cacheWriteTokens ?? 0),
    outputTokens: task.outputTokens + (step.outputTokens ?? 0),
    ...(step.model ? { model: step.model } : {}),
  });
  return stepIndex;
}

/** All descendants of a task (breadth-first, bounded). */
export async function collectDescendants(ctx: QueryCtx | MutationCtx, taskId: Id<"tasks">): Promise<Doc<"tasks">[]> {
  const result: Doc<"tasks">[] = [];
  const queue: Id<"tasks">[] = [taskId];
  while (queue.length > 0 && result.length < 200) {
    const current = queue.shift()!;
    const children = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", current)).take(50);
    for (const child of children) {
      result.push(child);
      queue.push(child._id);
    }
  }
  return result;
}

const ACTIVE_STATUSES: TaskStatus[] = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"];

/**
 * Cooperative cancellation: flags the task and all descendants, cancels their
 * pending approvals and records who stopped them and why. The running loop
 * observes the flag within one poll interval and finalises the CANCELLED state.
 */
export async function requestCancel(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, reason: string): Promise<{ cancelled: Id<"tasks">[] }> {
  const task = await ctx.db.get(taskId);
  if (!task) throw appError("NOT_FOUND", "المهمة غير موجودة");
  const targets = [task, ...(await collectDescendants(ctx, taskId))];
  const cancelled: Id<"tasks">[] = [];
  const now = Date.now();
  for (const t of targets) {
    if (!ACTIVE_STATUSES.includes(t.status)) continue;
    const immediate = t.status !== "RUNNING";
    await ctx.db.patch(t._id, {
      cancelRequested: true,
      cancelReason: reason,
      cancelledBy: actor,
      status: immediate ? "CANCELLED" : "CANCELLING",
      ...(immediate ? { finishedAt: now } : {}),
    });
    if (t.schedulerJobId && immediate) {
      await ctx.scheduler.cancel(t.schedulerJobId);
    }
    if (!immediate) {
      // The loop normally finalises within one poll; this guarantees completion even if it died.
      await ctx.scheduler.runAfter(10_000, internal.agents.runtime.forceCancel, { taskId: t._id });
    }
    await cancelPendingApprovalsForTask(ctx, actor, t._id, reason);
    await ctx.db.insert("taskRuns", {
      taskId: t._id,
      stepIndex: t.stepCount + 1,
      kind: "CANCELLED",
      note: `طلب الإيقاف: ${reason}`,
      createdAt: now,
    });
    await ctx.db.patch(t._id, { stepCount: t.stepCount + 1 });
    await appendAudit(ctx, {
      actor,
      table: "tasks",
      recordId: t._id,
      businessId: t.businessId,
      event: "CANCEL",
      oldValue: { status: t.status },
      newValue: { status: immediate ? "CANCELLED" : "CANCELLING" },
      reason,
      severity: "D2",
      taskId: t._id,
    });
    cancelled.push(t._id);
  }
  return { cancelled };
}

export async function cancelPendingApprovalsForTask(ctx: MutationCtx, actor: Actor, taskId: Id<"tasks">, reason: string) {
  const approvals = await ctx.db.query("approvals").withIndex("by_task", (q) => q.eq("taskId", taskId)).take(50);
  for (const approval of approvals) {
    if (approval.status !== "PENDING") continue;
    await ctx.db.patch(approval._id, { status: "CANCELLED", decidedAt: Date.now(), decidedBy: actor, decisionReason: reason });
    await appendAudit(ctx, {
      actor,
      table: "approvals",
      recordId: approval._id,
      businessId: approval.businessId,
      event: "CANCEL",
      oldValue: { status: "PENDING" },
      newValue: { status: "CANCELLED" },
      reason,
      severity: "D1",
      taskId,
      approvalId: approval._id,
    });
  }
}

/** Called by the loop once it has observed the cancel flag and saved partial output. */
export async function finalizeCancellation(ctx: MutationCtx, taskId: Id<"tasks">, partialResult: string | undefined) {
  const task = await ctx.db.get(taskId);
  if (!task) return;
  if (task.status === "CANCELLED") return;
  await ctx.db.patch(taskId, {
    status: "CANCELLED",
    finishedAt: Date.now(),
    ...(partialResult ? { partialResult } : {}),
  });
}

export async function listActiveTasks(ctx: QueryCtx | MutationCtx): Promise<Doc<"tasks">[]> {
  const result: Doc<"tasks">[] = [];
  for (const status of ACTIVE_STATUSES) {
    const rows = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", status)).take(200);
    result.push(...rows);
  }
  return result;
}

/** Emergency stop: cancels every active task and blocks new ones until the owner resumes. */
export async function emergencyStop(ctx: MutationCtx, actor: Actor, reason: string): Promise<number> {
  await setSetting(ctx, "emergencyStop", { active: true, activatedAt: Date.now(), activatedBy: actor.id, reason }, actor);
  const active = await listActiveTasks(ctx);
  let count = 0;
  for (const task of active) {
    if (task.parentTaskId) continue; // handled through its root
    const { cancelled } = await requestCancel(ctx, actor, task._id, `إيقاف طارئ: ${reason}`);
    count += cancelled.length;
  }
  // Orphans whose root was already finished.
  for (const task of await listActiveTasks(ctx)) {
    const { cancelled } = await requestCancel(ctx, actor, task._id, `إيقاف طارئ: ${reason}`);
    count += cancelled.length;
  }
  await appendAudit(ctx, { actor, table: "settings", recordId: "emergencyStop", event: "EMERGENCY_STOP", newValue: { active: true, cancelledTasks: count }, reason, severity: "D4" });
  return count;
}

export async function emergencyResume(ctx: MutationCtx, actor: Actor) {
  await setSetting(ctx, "emergencyStop", { active: false, activatedAt: undefined, activatedBy: undefined, reason: undefined }, actor);
  await appendAudit(ctx, { actor, table: "settings", recordId: "emergencyStop", event: "EMERGENCY_RESUME", newValue: { active: false }, severity: "D4" });
}
