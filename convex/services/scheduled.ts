/**
 * Scheduled jobs (Phase 4). Each job is idempotent for its day, respects the
 * owner's switches in `settings.scheduledTasks`, and writes one SYSTEM audit
 * row per run (table "settings", recordId `cron:<job>`) so the settings page
 * can show the last result. Jobs that need a model create ordinary tasks
 * (origin `system`) — the routing, budget and approval rules stay unchanged.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { systemActor, type Actor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { getSetting } from "../lib/settings";
import { runFollowUps } from "./followUps";
import { createTask } from "./tasks";
import { monthlyUsage } from "./usage";

export const SCHEDULED_JOBS = ["dailyDigest", "leadFollowUpReminders", "weeklyExecutiveSummary", "lifecycleFollowUps"] as const;
export type ScheduledJob = (typeof SCHEDULED_JOBS)[number];

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ts: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

async function notificationExists(ctx: QueryCtx | MutationCtx, kind: string, relatedRecordId: string): Promise<boolean> {
  const recent = await ctx.db.query("notifications").order("desc").take(200);
  return recent.some((n) => n.kind === kind && n.relatedRecordId === relatedRecordId);
}

// ---------------------------------------------------------------------------
// Daily digest (no model call)
// ---------------------------------------------------------------------------
export interface DigestSummary {
  pendingApprovals: number;
  newMessages: number;
  proposedReplies: number;
  escalatedMessages: number;
  overdueLeadFollowUps: number;
  followUpsPendingApproval: number;
  failedTasksYesterday: number;
  budgetPercent: number;
  expiringRates: number;
}

export async function buildDigest(ctx: QueryCtx | MutationCtx, now: number = Date.now()): Promise<DigestSummary> {
  const pendingApprovals = (await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "PENDING")).take(500)).length;
  const inboundOnly = async (status: Doc<"interactions">["status"]) => (await ctx.db.query("interactions").withIndex("by_status", (q) => q.eq("status", status)).take(500)).filter((i) => i.direction === "INBOUND").length;
  const leads = (await ctx.db.query("leads").withIndex("by_nextFollowUp", (q) => q.lt("nextFollowUpAt", now)).take(500)).filter((l) => !l.archivedAt && l.stage !== "WON" && l.stage !== "LOST" && l.nextFollowUpAt !== undefined);
  const failed = (await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "FAILED")).take(500)).filter((t) => (t.finishedAt ?? 0) >= now - DAY).length;
  const usage = await monthlyUsage(ctx);
  const rates = (await ctx.db.query("rates").take(3000)).filter((r) => !r.archivedAt && r.freshness === "EXPIRING").length;
  return {
    pendingApprovals,
    newMessages: await inboundOnly("NEW"),
    proposedReplies: await inboundOnly("REPLY_PROPOSED"),
    escalatedMessages: await inboundOnly("ESCALATED"),
    overdueLeadFollowUps: leads.length,
    followUpsPendingApproval: (await ctx.db.query("followUps").withIndex("by_status_dueAt", (q) => q.eq("status", "PENDING_APPROVAL")).take(500)).length,
    failedTasksYesterday: failed,
    budgetPercent: usage.percentOfBudget,
    expiringRates: rates,
  };
}

export function formatDigest(d: DigestSummary): string {
  const lines = [
    `• بانتظار اعتمادك: ${d.pendingApprovals}`,
    `• رسائل عملاء جديدة: ${d.newMessages} · ردود مقترحة: ${d.proposedReplies} · مصعّدة: ${d.escalatedMessages}`,
    `• متابعات عملاء محتملين متأخرة: ${d.overdueLeadFollowUps}`,
    `• رسائل ما بعد البيع بانتظار الاعتماد: ${d.followUpsPendingApproval}`,
    `• مهام فشلت خلال 24 ساعة: ${d.failedTasksYesterday}`,
    `• استهلاك ميزانية الذكاء الاصطناعي: ${d.budgetPercent}%`,
    `• أسعار تقترب من الانتهاء: ${d.expiringRates}`,
  ];
  return lines.join("\n");
}

export async function dailyDigest(ctx: MutationCtx, now: number = Date.now()): Promise<{ created: boolean; summary: DigestSummary }> {
  const company = await getSetting(ctx, "company");
  const key = dayKey(now, company.timezone);
  const summary = await buildDigest(ctx, now);
  if (await notificationExists(ctx, "DAILY_DIGEST", key)) return { created: false, summary };
  const urgent = summary.pendingApprovals > 0 || summary.escalatedMessages > 0 || summary.failedTasksYesterday > 0 || summary.budgetPercent >= 80;
  await ctx.db.insert("notifications", {
    kind: "DAILY_DIGEST",
    title: `ملخص اليوم ${key}`,
    body: formatDigest(summary),
    severity: urgent ? "WARNING" : "INFO",
    relatedTable: "settings",
    relatedRecordId: key,
    createdAt: now,
  });
  return { created: true, summary };
}

// ---------------------------------------------------------------------------
// Lead follow-up reminders → sales agent tasks (capped)
// ---------------------------------------------------------------------------
const REMINDER_ACTOR = systemActor("cron:leadFollowUpReminders");

async function startSystemTask(ctx: MutationCtx, input: { title: string; request: string; agentSlug: Doc<"agents">["slug"]; requestedBy: Actor; priority?: Doc<"tasks">["priority"]; contextRefs?: Doc<"tasks">["contextRefs"] }): Promise<Id<"tasks">> {
  const taskId = await createTask(ctx, { ...input, origin: "system" });
  const jobId = await ctx.scheduler.runAfter(0, internal.agents.loop.run, { taskId });
  await ctx.db.patch(taskId, { schedulerJobId: jobId });
  return taskId;
}

export async function leadFollowUpReminders(ctx: MutationCtx, now: number = Date.now()): Promise<{ created: number; skipped: number; capped: boolean }> {
  const settings = await getSetting(ctx, "scheduledTasks");
  const stop = await getSetting(ctx, "emergencyStop");
  const sales = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", "sales")).unique();
  if (stop.active || !sales?.enabled) return { created: 0, skipped: 0, capped: false };
  const cap = Math.max(0, settings.leadRemindersPerDay ?? 0);
  const overdue = (await ctx.db.query("leads").withIndex("by_nextFollowUp", (q) => q.lt("nextFollowUpAt", now)).take(200)).filter((l) => !l.archivedAt && l.nextFollowUpAt !== undefined && l.stage !== "WON" && l.stage !== "LOST");
  // Leads already covered: a pending customer-message approval, an active task, or a reminder in the last 3 days.
  const pending = await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "PENDING")).take(500);
  const coveredByApproval = new Set(pending.map((a) => (a.payload as { leadId?: string } | undefined)?.leadId).filter(Boolean));
  const recentTasks = await ctx.db.query("tasks").order("desc").take(300);
  const coveredByTask = new Set<string>();
  for (const t of recentTasks) {
    const active = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"].includes(t.status);
    const recentReminder = t.requestedBy.id === REMINDER_ACTOR.id && t._creationTime >= now - 3 * DAY;
    if (active || recentReminder) for (const id of t.contextRefs.leadIds) coveredByTask.add(id);
  }
  // Also count today's reminders against the cap.
  const startOfDay = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  let created = recentTasks.filter((t) => t.requestedBy.id === REMINDER_ACTOR.id && t._creationTime >= startOfDay).length;
  let skipped = 0;
  let capped = false;
  const sorted = overdue.sort((a, b) => (a.nextFollowUpAt ?? 0) - (b.nextFollowUpAt ?? 0));
  let newlyCreated = 0;
  for (const lead of sorted) {
    if (coveredByApproval.has(lead._id) || coveredByTask.has(lead._id)) {
      skipped += 1;
      continue;
    }
    if (created >= cap) {
      capped = true;
      break;
    }
    const daysLate = Math.max(1, Math.floor((now - (lead.nextFollowUpAt ?? now)) / DAY));
    await startSystemTask(ctx, {
      title: `متابعة مستحقة: ${lead.contactName}`.slice(0, 80),
      request: [
        `العميل المحتمل ${lead.businessId} (${lead.contactName}) بمرحلة ${lead.stage} كانت متابعته مستحقة منذ ${daysLate} يوم/أيام عبر قناة ${lead.channel}.`,
        "راجع سجله وآخر تواصل وعروضه (search_leads, search_quotes, search_interactions)، ثم اقترح رسالة متابعة مناسبة بلغته عبر propose_follow_up مع موعد المتابعة التالية.",
        "إن كان العميل غير مستجيب لفترة طويلة فاقترح نقله إلى LOST بسبب NO_RESPONSE عبر update_lead_stage بدلاً من رسالة أخرى. لا تذكر أسعاراً غير موجودة في عرض أو منتج فعّال.",
      ].join("\n"),
      agentSlug: "sales",
      requestedBy: REMINDER_ACTOR,
      priority: "NORMAL",
      contextRefs: { customerIds: lead.customerId ? [lead.customerId] : [], leadIds: [lead._id], productIds: lead.interestedProductId ? [lead.interestedProductId] : [], bookingIds: [] },
    });
    created += 1;
    newlyCreated += 1;
  }
  return { created: newlyCreated, skipped, capped };
}

// ---------------------------------------------------------------------------
// Weekly executive summary → executive agent task
// ---------------------------------------------------------------------------
const SUMMARY_ACTOR = systemActor("cron:weeklyExecutiveSummary");

export async function weeklyExecutiveSummary(ctx: MutationCtx, now: number = Date.now()): Promise<{ taskId?: Id<"tasks">; skipped?: string }> {
  const stop = await getSetting(ctx, "emergencyStop");
  const executive = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", "executive")).unique();
  if (stop.active) return { skipped: "emergency_stop" };
  if (!executive?.enabled) return { skipped: "executive_disabled" };
  const recent = await ctx.db.query("tasks").order("desc").take(200);
  if (recent.some((t) => t.requestedBy.id === SUMMARY_ACTOR.id && t._creationTime >= now - 6 * DAY)) return { skipped: "already_this_week" };
  const company = await getSetting(ctx, "company");
  const taskId = await startSystemTask(ctx, {
    title: `الملخص التنفيذي الأسبوعي ${dayKey(now, company.timezone)}`,
    request: [
      "أعدّ الملخص التنفيذي الأسبوعي للمالك من البيانات فقط:",
      "1) مؤشرات الشهر الحالي (get_kpis) مع مقارنة سريعة بالشهر السابق (get_report kind=monthly_series).",
      "2) خط المبيعات: العملاء الراكدون والمتابعات المتأخرة والعروض التي تنتهي قريباً (pipeline_report).",
      "3) خدمة العملاء: حجم الرسائل، زمن الاستجابة، الشكاوى والتصعيدات (get_report kind=support).",
      "4) أداء الوكلاء والتكلفة مقابل الميزانية والتوقع لنهاية الشهر (get_report kind=agent_performance و kind=cost).",
      "5) ما ينتظر اعتماد المالك (list_pending_approvals) والمهام الجارية (list_tasks).",
      "اختم بثلاث توصيات مرقّمة قابلة للتنفيذ هذا الأسبوع. لا تفوّض مهام فرعية، ولا تنشئ طلبات اعتماد؛ هذا تقرير قراءة فقط. اكتب بالعربية بعناوين قصيرة.",
    ].join("\n"),
    agentSlug: "executive",
    requestedBy: SUMMARY_ACTOR,
    priority: "LOW",
  });
  return { taskId };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
export async function runScheduledJob(ctx: MutationCtx, job: ScheduledJob, opts: { actor?: Actor; force?: boolean; now?: number } = {}): Promise<Record<string, unknown>> {
  const now = opts.now ?? Date.now();
  const settings = await getSetting(ctx, "scheduledTasks");
  const enabled = job === "dailyDigest" ? settings.dailyDigest : job === "leadFollowUpReminders" ? settings.leadFollowUpReminders : job === "weeklyExecutiveSummary" ? settings.weeklyExecutiveSummary : settings.lifecycleFollowUps;
  let result: Record<string, unknown>;
  if (!enabled && !opts.force) {
    result = { skipped: "disabled" };
  } else {
    switch (job) {
      case "dailyDigest":
        result = await dailyDigest(ctx, now);
        break;
      case "leadFollowUpReminders":
        result = await leadFollowUpReminders(ctx, now);
        break;
      case "weeklyExecutiveSummary":
        result = await weeklyExecutiveSummary(ctx, now);
        break;
      case "lifecycleFollowUps":
        result = await runFollowUps(ctx, now);
        break;
    }
  }
  await appendAudit(ctx, { actor: opts.actor ?? systemActor(`cron:${job}`), table: "settings", recordId: `cron:${job}`, event: "SYSTEM", newValue: { job, manual: !!opts.actor, ...result }, severity: "D1" });
  return result;
}

/** Last run per job from the audit log (no extra table). */
export async function scheduledStatus(ctx: QueryCtx | MutationCtx) {
  const settings = await getSetting(ctx, "scheduledTasks");
  const out = [];
  for (const job of SCHEDULED_JOBS) {
    const last = (await ctx.db.query("auditLog").withIndex("by_table_record", (q) => q.eq("table", "settings").eq("recordId", `cron:${job}`)).order("desc").take(1))[0];
    const enabled = job === "dailyDigest" ? settings.dailyDigest : job === "leadFollowUpReminders" ? settings.leadFollowUpReminders : job === "weeklyExecutiveSummary" ? settings.weeklyExecutiveSummary : settings.lifecycleFollowUps;
    out.push({ job, enabled, lastRunAt: last?.at ?? null, lastResult: (last?.newValue as Record<string, unknown> | undefined) ?? null, manual: last?.actor.type === "owner" });
  }
  return out;
}
