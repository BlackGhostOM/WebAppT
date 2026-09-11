/**
 * Owner-defined recurring agent tasks. The owner describes what an agent should
 * do and when; a cron (every 5 minutes) turns due schedules into ordinary tasks
 * with origin `system`, so model routing, budgets, approvals and the emergency
 * stop apply exactly as for any other task. Completion notifies the owner via
 * the existing `cron:` requestedBy convention.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { systemActor, type Actor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { appError } from "../lib/errors";
import { nextBusinessId } from "../lib/ids";
import { nextOccurrence, type ScheduleRule } from "../lib/schedule";
import { getSetting } from "../lib/settings";
import * as V from "../lib/vocab";
import { createTask } from "./tasks";

export interface CustomScheduleInput {
  title: string;
  agentSlug: string;
  request: string;
  priority?: string;
  frequency: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour?: number;
  minute?: number;
  runAt?: number;
  enabled?: boolean;
}

function validate(input: CustomScheduleInput): Required<Pick<CustomScheduleInput, "title" | "request">> & { agentSlug: V.AgentSlug; priority: Doc<"tasks">["priority"]; rule: ScheduleRule } {
  const title = input.title?.trim() ?? "";
  const request = input.request?.trim() ?? "";
  if (title.length < 2 || title.length > 120) throw appError("VALIDATION", "title: بين 2 و120 حرفاً", { field: "title" });
  if (request.length < 10 || request.length > 4000) throw appError("VALIDATION", "request: بين 10 و4000 حرف", { field: "request" });
  if (!V.isOneOf(V.AGENT_SLUGS, input.agentSlug)) throw appError("VALIDATION", "agentSlug: وكيل غير معياري", { field: "agentSlug" });
  const priority = input.priority ?? "NORMAL";
  if (!V.isOneOf(V.TASK_PRIORITIES, priority)) throw appError("VALIDATION", "priority: أولوية غير معيارية", { field: "priority" });
  if (!V.isOneOf(V.SCHEDULE_FREQUENCIES, input.frequency)) throw appError("VALIDATION", "frequency: تكرار غير معياري", { field: "frequency" });
  const hour = input.hour ?? 8;
  const minute = input.minute ?? 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw appError("VALIDATION", "hour: بين 0 و23", { field: "hour" });
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw appError("VALIDATION", "minute: بين 0 و59", { field: "minute" });
  const rule: ScheduleRule = { frequency: input.frequency, hour, minute };
  if (input.frequency === "WEEKLY") {
    if (input.dayOfWeek === undefined || !Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) throw appError("VALIDATION", "dayOfWeek: بين 0 (الأحد) و6 (السبت)", { field: "dayOfWeek" });
    rule.dayOfWeek = input.dayOfWeek;
  }
  if (input.frequency === "MONTHLY") {
    if (input.dayOfMonth === undefined || !Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28) throw appError("VALIDATION", "dayOfMonth: بين 1 و28 حتى يصلح لكل الأشهر", { field: "dayOfMonth" });
    rule.dayOfMonth = input.dayOfMonth;
  }
  if (input.frequency === "ONCE") {
    if (input.runAt === undefined || !Number.isFinite(input.runAt)) throw appError("VALIDATION", "runAt: وقت التشغيل إلزامي", { field: "runAt" });
    rule.runAt = input.runAt;
  }
  return { title, request, agentSlug: input.agentSlug, priority, rule };
}

async function timezone(ctx: QueryCtx | MutationCtx): Promise<string> {
  return (await getSetting(ctx, "company")).timezone || "Asia/Muscat";
}

export async function createCustomSchedule(ctx: MutationCtx, actor: Actor, input: CustomScheduleInput): Promise<{ id: Id<"customSchedules">; businessId: string; nextRunAt: number | null }> {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "المهام المجدولة المخصصة يديرها المالك");
  const v = validate(input);
  const agent = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", v.agentSlug)).unique();
  if (!agent) throw appError("NOT_FOUND", `الوكيل ${v.agentSlug} غير معرّف`);
  const now = Date.now();
  const tz = await timezone(ctx);
  const nextRunAt = nextOccurrence(v.rule, now, tz);
  if (v.rule.frequency === "ONCE" && nextRunAt === null) throw appError("VALIDATION", "runAt: الوقت يجب أن يكون في المستقبل", { field: "runAt" });
  const businessId = await nextBusinessId(ctx, "customSchedules");
  const id = await ctx.db.insert("customSchedules", {
    businessId,
    title: v.title,
    agentSlug: v.agentSlug,
    request: v.request,
    priority: v.priority,
    frequency: v.rule.frequency,
    dayOfWeek: v.rule.dayOfWeek,
    dayOfMonth: v.rule.dayOfMonth,
    hour: v.rule.hour,
    minute: v.rule.minute,
    runAt: v.rule.runAt,
    enabled: input.enabled ?? true,
    nextRunAt: nextRunAt ?? undefined,
    runCount: 0,
    createdBy: actor,
    updatedBy: actor,
    createdAt: now,
    updatedAt: now,
  });
  await appendAudit(ctx, { actor, table: "customSchedules", recordId: id, businessId, event: "CREATE", newValue: { title: v.title, agentSlug: v.agentSlug, frequency: v.rule.frequency, nextRunAt }, severity: "D2" });
  return { id, businessId, nextRunAt };
}

export async function updateCustomSchedule(ctx: MutationCtx, actor: Actor, id: Id<"customSchedules">, input: CustomScheduleInput): Promise<{ nextRunAt: number | null }> {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "المهام المجدولة المخصصة يديرها المالك");
  const existing = await ctx.db.get(id);
  if (!existing) throw appError("NOT_FOUND", "المهمة المجدولة غير موجودة");
  const v = validate(input);
  const now = Date.now();
  const nextRunAt = nextOccurrence(v.rule, now, await timezone(ctx));
  const enabled = input.enabled ?? existing.enabled;
  await ctx.db.patch(id, {
    title: v.title,
    agentSlug: v.agentSlug,
    request: v.request,
    priority: v.priority,
    frequency: v.rule.frequency,
    dayOfWeek: v.rule.dayOfWeek,
    dayOfMonth: v.rule.dayOfMonth,
    hour: v.rule.hour,
    minute: v.rule.minute,
    runAt: v.rule.runAt,
    enabled,
    nextRunAt: nextRunAt ?? undefined,
    updatedBy: actor,
    updatedAt: now,
  });
  await appendAudit(ctx, { actor, table: "customSchedules", recordId: id, businessId: existing.businessId, event: "UPDATE", oldValue: { title: existing.title, frequency: existing.frequency, enabled: existing.enabled }, newValue: { title: v.title, frequency: v.rule.frequency, enabled, nextRunAt }, severity: "D2" });
  return { nextRunAt };
}

export async function setCustomScheduleEnabled(ctx: MutationCtx, actor: Actor, id: Id<"customSchedules">, enabled: boolean) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "المهام المجدولة المخصصة يديرها المالك");
  const existing = await ctx.db.get(id);
  if (!existing) throw appError("NOT_FOUND", "المهمة المجدولة غير موجودة");
  const now = Date.now();
  const rule: ScheduleRule = { frequency: existing.frequency, hour: existing.hour, minute: existing.minute, dayOfWeek: existing.dayOfWeek, dayOfMonth: existing.dayOfMonth, runAt: existing.runAt };
  // Re-enabling recomputes the next run so a long-disabled schedule does not fire immediately for missed slots.
  const nextRunAt = enabled ? nextOccurrence(rule, now, await timezone(ctx)) : existing.nextRunAt;
  await ctx.db.patch(id, { enabled, nextRunAt: nextRunAt ?? undefined, updatedBy: actor, updatedAt: now });
  await appendAudit(ctx, { actor, table: "customSchedules", recordId: id, businessId: existing.businessId, event: "UPDATE", oldValue: { enabled: existing.enabled }, newValue: { enabled, nextRunAt }, severity: "D2" });
}

export async function removeCustomSchedule(ctx: MutationCtx, actor: Actor, id: Id<"customSchedules">) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "المهام المجدولة المخصصة يديرها المالك");
  const existing = await ctx.db.get(id);
  if (!existing) throw appError("NOT_FOUND", "المهمة المجدولة غير موجودة");
  await ctx.db.delete(id);
  await appendAudit(ctx, { actor, table: "customSchedules", recordId: id, businessId: existing.businessId, event: "ARCHIVE", oldValue: { title: existing.title, frequency: existing.frequency }, severity: "D2" });
}

/** Starts the agent task for one schedule (cron or owner "run now"). Returns the task id or the skip reason. */
export async function fireCustomSchedule(ctx: MutationCtx, schedule: Doc<"customSchedules">, trigger: "cron" | "manual", actor?: Actor): Promise<{ taskId?: Id<"tasks">; skipped?: string }> {
  const now = Date.now();
  const stop = await getSetting(ctx, "emergencyStop");
  const agent = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", schedule.agentSlug)).unique();
  const requestedBy = actor ?? systemActor(`cron:custom:${schedule.businessId}`);
  const skip = async (reason: string) => {
    await ctx.db.patch(schedule._id, { lastSkipReason: reason, updatedAt: now });
    return { skipped: reason };
  };
  if (stop.active) return await skip("emergency_stop");
  if (!agent?.enabled) return await skip("agent_disabled");
  const taskId = await createTask(ctx, {
    title: schedule.title.slice(0, 80),
    request: `${schedule.request}\n\n(مهمة مجدولة ${schedule.businessId} — ${trigger === "cron" ? "تشغيل آلي" : "تشغيل يدوي من المالك"}. أنهِ بملخص للمالك؛ أي إجراء يمس المال أو العملاء يمر عبر الاعتماد كالمعتاد.)`,
    origin: "system",
    agentSlug: schedule.agentSlug,
    requestedBy: { type: "system", id: `cron:custom:${schedule.businessId}` },
    priority: schedule.priority,
  });
  const jobId = await ctx.scheduler.runAfter(0, internal.agents.loop.run, { taskId });
  await ctx.db.patch(taskId, { schedulerJobId: jobId });
  await ctx.db.patch(schedule._id, { lastRunAt: now, lastTaskId: taskId, lastSkipReason: undefined, runCount: schedule.runCount + 1, updatedAt: now });
  await appendAudit(ctx, { actor: requestedBy, table: "customSchedules", recordId: schedule._id, businessId: schedule.businessId, event: "SYSTEM", newValue: { trigger, taskId }, severity: "D1", taskId });
  return { taskId };
}

/** Cron entry: fire every enabled schedule whose time has come, then advance (or retire ONCE schedules). */
export async function runDueCustomSchedules(ctx: MutationCtx, now: number = Date.now()): Promise<{ fired: number; skipped: number }> {
  const due = await ctx.db.query("customSchedules").withIndex("by_enabled_nextRunAt", (q) => q.eq("enabled", true).lte("nextRunAt", now)).take(50);
  const tz = await timezone(ctx);
  let fired = 0;
  let skipped = 0;
  for (const schedule of due) {
    if (schedule.nextRunAt === undefined) continue;
    const result = await fireCustomSchedule(ctx, schedule, "cron");
    if (result.taskId) fired += 1;
    else skipped += 1;
    const rule: ScheduleRule = { frequency: schedule.frequency, hour: schedule.hour, minute: schedule.minute, dayOfWeek: schedule.dayOfWeek, dayOfMonth: schedule.dayOfMonth, runAt: schedule.runAt };
    const next = schedule.frequency === "ONCE" ? null : nextOccurrence(rule, now, tz);
    // A skipped slot is not retried: the next occurrence is computed from now, like any missed cron.
    await ctx.db.patch(schedule._id, next === null ? { enabled: false, nextRunAt: undefined, updatedAt: now } : { nextRunAt: next, updatedAt: now });
  }
  return { fired, skipped };
}
