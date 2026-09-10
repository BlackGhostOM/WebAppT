import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AUTO_RULE_ACTOR_ID, autoApprove, createApproval, evaluateAutoApproval, inQuietHours, localHour } from "../../convex/services/approvals";
import { processDueFollowUps, scheduleFollowUpsForBooking } from "../../convex/services/followUps";
import { receiveInbound } from "../../convex/services/inbox";
import { createRecord } from "../../convex/services/records";
import { agentPerformance, bookingsReport, costReport, monthKeysBack, monthlySeries, supportReport } from "../../convex/services/reports";
import { dailyDigest, leadFollowUpReminders, runScheduledJob, weeklyExecutiveSummary } from "../../convex/services/scheduled";
import { logUsage } from "../../convex/services/usage";
import { AGENT, type Harness, OWNER_ACTOR, setup } from "./helpers";

const DAY = 86_400_000;

/** A quiet-hours window that is never active, so tests are independent of the wall clock. */
async function disableQuietHours(h: Harness) {
  await h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { quietHours: { enabled: false, startHour: 22, endHour: 8 } } });
}

async function confirmedBooking(h: Harness, phone = "+968 99000002") {
  const owner = OWNER_ACTOR(h.ownerId);
  const customer = await h.t.run(async (ctx) => createRecord(ctx, owner, "customers", { fullName: "خالد الريامي", customerType: "FAMILY", preferredLanguage: "ar", consentStatus: "GRANTED", phone }, { acknowledgeDuplicates: true }));
  const now = Date.now();
  const bookingId = await h.t.run(async (ctx) =>
    ctx.db.insert("bookings", {
      businessId: `BKG-2026-${phone.slice(-6)}`,
      trustLevel: "A_COMPANY_VERIFIED",
      verificationStatus: "HUMAN_VERIFIED",
      source: { kind: "human", ref: h.ownerId },
      classification: "CUSTOMER_CONFIDENTIAL",
      dataOwnerAgent: "support",
      legalEntity: "test",
      country: "OM",
      createdBy: owner,
      updatedBy: owner,
      createdAt: now,
      updatedAt: now,
      customerId: customer.id as Id<"customers">,
      status: "CONFIRMED",
      paymentStatus: "DEPOSIT_PAID",
      travelDateFrom: now + 10 * DAY,
      travelDateTo: now + 12 * DAY,
      timezone: "Asia/Muscat",
      paxAdults: 2,
      paxChildren: 0,
      totalSellingPrice: { amount: 300, currency: "OMR", baseAmount: 300, baseCurrency: "OMR" },
      confirmedAt: now,
    }),
  );
  return { bookingId, customerId: customer.id as Id<"customers"> };
}

describe("Phase 4 — auto-approval rule engine", () => {
  it("never auto-approves D4, booking confirmations or sensitive changes, even when the kind is enabled", async () => {
    const h = await setup();
    await disableQuietHours(h);
    await expect(h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { kinds: ["CONFIRM_BOOKING"] } })).rejects.toThrow(/VALIDATION|لا تقبل/);
    await h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { kinds: ["SEND_CUSTOMER_MESSAGE"] } });
    const d4 = await h.t.run(async (ctx) => evaluateAutoApproval(ctx, { kind: "SEND_CUSTOMER_MESSAGE", severity: "D4" }));
    expect(d4).toEqual({ auto: false, blockedBy: "never_auto" });
    const ok = await h.t.run(async (ctx) => evaluateAutoApproval(ctx, { kind: "SEND_CUSTOMER_MESSAGE", severity: "D3" }));
    expect(ok).toEqual({ auto: true, rule: "kind_rule" });
    const sensitive = await h.t.run(async (ctx) => evaluateAutoApproval(ctx, { kind: "SENSITIVE_CHANGE", severity: "D3" }));
    expect(sensitive.auto).toBe(false);
  });

  it("auto-approves only the follow-up kinds the owner selected and schedules execution", async () => {
    const h = await setup();
    await disableQuietHours(h);
    await h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { followUpKinds: ["WELCOME"] } });
    const welcome = await h.t.run(async (ctx) => createApproval(ctx, AGENT("support"), { kind: "SEND_CUSTOMER_MESSAGE", agentSlug: "support", title: "w", summary: "s", payload: { followUpId: "fu1", purpose: "WELCOME", message: "أهلاً" }, severity: "D3" }));
    expect(welcome.autoApproved).toBe(true);
    const doc = (await h.t.run(async (ctx) => ctx.db.get(welcome.approvalId)))!;
    expect(doc.status).toBe("APPROVED");
    expect(doc.decidedBy?.id).toBe(AUTO_RULE_ACTOR_ID);
    expect(doc.decisionReason).toContain("follow_up_rule");
    const survey = await h.t.run(async (ctx) => createApproval(ctx, AGENT("support"), { kind: "SEND_CUSTOMER_MESSAGE", agentSlug: "support", title: "s", summary: "s", payload: { followUpId: "fu2", purpose: "SATISFACTION_SURVEY", message: "؟" }, severity: "D3" }));
    expect(survey.autoApproved).toBe(false);
    expect((await h.t.run(async (ctx) => ctx.db.get(survey.approvalId)))?.status).toBe("PENDING");
    const log = await h.asOwner.query(api.settings.autoApprovals, {});
    expect(log.map((a) => a._id)).toEqual([welcome.approvalId]);
  });

  it("stops at the daily cap and inside quiet hours; the FAQ path obeys the same limits", async () => {
    const h = await setup();
    await disableQuietHours(h);
    await h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { kinds: ["PUBLISH_CONTENT"], maxPerDay: 1, faqAutoReply: true } });
    const first = await h.t.run(async (ctx) => createApproval(ctx, AGENT("sales"), { kind: "PUBLISH_CONTENT", agentSlug: "sales", title: "a", summary: "s", payload: {}, severity: "D3" }));
    expect(first.autoApproved).toBe(true);
    const second = await h.t.run(async (ctx) => createApproval(ctx, AGENT("sales"), { kind: "PUBLISH_CONTENT", agentSlug: "sales", title: "b", summary: "s", payload: {}, severity: "D3" }));
    expect(second.autoApproved).toBe(false);
    const audit = await h.t.run(async (ctx) => ctx.db.query("auditLog").withIndex("by_table_record", (q) => q.eq("table", "approvals").eq("recordId", second.approvalId)).take(5));
    expect((audit[0].newValue as { autoBlockedBy?: string }).autoBlockedBy).toBe("daily_cap");
    // FAQ path under the cap → refused for the same reason.
    const faq = await h.t.run(async (ctx) => createApproval(ctx, AGENT("support"), { kind: "SEND_CUSTOMER_MESSAGE", agentSlug: "support", title: "faq", summary: "s", payload: { interactionId: "x", purpose: "reply" }, severity: "D3" }));
    const blocked = await h.t.run(async (ctx) => autoApprove(ctx, faq.approvalId, "faq", { faqEligible: true }));
    expect(blocked).toEqual({ approved: false, blockedBy: "daily_cap" });

    // Quiet hours: a window covering the whole day blocks everything.
    await h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { maxPerDay: 100, quietHours: { enabled: true, startHour: 0, endHour: 23 } } });
    const quiet = await h.t.run(async (ctx) => evaluateAutoApproval(ctx, { kind: "PUBLISH_CONTENT", severity: "D3" }, Date.UTC(2026, 0, 1, 12)));
    expect(quiet).toMatchObject({ auto: false, blockedBy: "quiet_hours" });
    expect(inQuietHours(23, { startHour: 22, endHour: 8 })).toBe(true);
    expect(inQuietHours(3, { startHour: 22, endHour: 8 })).toBe(true);
    expect(inQuietHours(12, { startHour: 22, endHour: 8 })).toBe(false);
    expect(inQuietHours(12, { startHour: 9, endHour: 9 })).toBe(false);
    expect(localHour(Date.UTC(2026, 0, 1, 20), "Asia/Muscat")).toBe(0);
    await expect(h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { quietHours: { enabled: true, startHour: 25, endHour: 8 } } })).rejects.toThrow(/quietHours/);
  });
});

describe("Phase 4 — scheduled jobs", () => {
  it("writes one daily digest notification per day with the owner's open items", async () => {
    const h = await setup();
    await inboundMessage(h);
    const first = await h.t.run(async (ctx) => dailyDigest(ctx));
    expect(first.created).toBe(true);
    expect(first.summary.newMessages).toBe(1);
    const second = await h.t.run(async (ctx) => dailyDigest(ctx));
    expect(second.created).toBe(false);
    const notes = await h.t.run(async (ctx) => (await ctx.db.query("notifications").take(20)).filter((n) => n.kind === "DAILY_DIGEST"));
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain("رسائل عملاء جديدة: 1");
  });

  it("creates capped sales tasks for overdue lead follow-ups and skips covered leads", async () => {
    const h = await setup();
    const owner = OWNER_ACTOR(h.ownerId);
    const overdue = Date.now() - 2 * DAY;
    for (const name of ["أحمد البلوشي", "بدر الحارثي", "سالم العامري"]) {
      await h.t.run(async (ctx) => createRecord(ctx, owner, "leads", { contactName: name, channel: "WHATSAPP", stage: "QUALIFIED", nextFollowUpAt: overdue }, { acknowledgeDuplicates: true }));
    }
    const won = await h.t.run(async (ctx) => createRecord(ctx, owner, "leads", { contactName: "فائز الكندي", channel: "WHATSAPP", stage: "WON", nextFollowUpAt: overdue }));
    expect(won.id).toBeTruthy();
    // Disabled by default → nothing happens through the dispatcher.
    const disabled = await h.t.run(async (ctx) => runScheduledJob(ctx, "leadFollowUpReminders"));
    expect(disabled).toEqual({ skipped: "disabled" });
    await h.asOwner.mutation(api.settings.update, { key: "scheduledTasks", value: { leadFollowUpReminders: true, leadRemindersPerDay: 2 } });
    const run = await h.t.run(async (ctx) => leadFollowUpReminders(ctx));
    expect(run).toEqual({ created: 2, skipped: 0, capped: true });
    const tasks = await h.t.run(async (ctx) => ctx.db.query("tasks").take(10));
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.agentSlug === "sales" && t.origin === "system" && t.contextRefs.leadIds.length === 1)).toBe(true);
    // Running again the same day: the two leads are covered by active tasks and the cap is already used.
    const again = await h.t.run(async (ctx) => leadFollowUpReminders(ctx));
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(2);
    const status = await h.asOwner.query(api.scheduled.status, {});
    expect(status.find((s) => s.job === "leadFollowUpReminders")?.lastRunAt).toBeTruthy();
  });

  it("creates one weekly executive summary task and notifies the owner when it completes", async () => {
    const h = await setup();
    const first = await h.t.run(async (ctx) => weeklyExecutiveSummary(ctx));
    expect(first.taskId).toBeTruthy();
    const task = (await h.t.run(async (ctx) => ctx.db.get(first.taskId!)))!;
    expect(task).toMatchObject({ agentSlug: "executive", origin: "system", priority: "LOW" });
    expect(task.request).toContain("get_report");
    const second = await h.t.run(async (ctx) => weeklyExecutiveSummary(ctx));
    expect(second.skipped).toBe("already_this_week");
    await h.t.action(internal.agents.loop.run, { taskId: first.taskId! });
    const done = (await h.t.run(async (ctx) => ctx.db.get(first.taskId!)))!;
    expect(done.status).toBe("COMPLETED");
    const note = await h.t.run(async (ctx) => (await ctx.db.query("notifications").take(20)).find((n) => n.kind === "SCHEDULED_TASK_DONE"));
    expect(note?.relatedRecordId).toBe(first.taskId);
    // The owner can trigger any job directly; staff cannot.
    await expect(h.asStaff.mutation(api.scheduled.runNow, { job: "dailyDigest" })).rejects.toThrow(/FORBIDDEN|المالك/);
    const manual = await h.asOwner.mutation(api.scheduled.runNow, { job: "dailyDigest" });
    expect(manual).toMatchObject({ created: true });
  });

  it("follow-up planner honours the scheduledTasks switch", async () => {
    const h = await setup();
    await confirmedBooking(h);
    await h.asOwner.mutation(api.settings.update, { key: "scheduledTasks", value: { lifecycleFollowUps: false } });
    expect(await h.t.run(async (ctx) => runScheduledJob(ctx, "lifecycleFollowUps"))).toEqual({ skipped: "disabled" });
    await h.asOwner.mutation(api.settings.update, { key: "scheduledTasks", value: { lifecycleFollowUps: true } });
    const result = await h.t.run(async (ctx) => runScheduledJob(ctx, "lifecycleFollowUps"));
    expect(result).toMatchObject({ scheduled: 3, proposed: 1 });
  });
});

async function inboundMessage(h: Harness, body = "هل عندكم رحلات إلى صلالة؟", sender = "ig-1") {
  return await h.t.run(async (ctx) => receiveInbound(ctx, { channel: "INSTAGRAM", body, externalId: `mid-${sender}-${Math.random()}`, externalSenderId: sender, senderName: "عميل", source: "webhook" }));
}

describe("Phase 4 — reports computed from data", () => {
  it("builds the monthly series with the current month's activity and zeros elsewhere", async () => {
    const h = await setup();
    await inboundMessage(h);
    await h.t.run(async (ctx) => createRecord(ctx, OWNER_ACTOR(h.ownerId), "leads", { contactName: "أحمد البلوشي", channel: "INSTAGRAM", stage: "WON" }));
    await confirmedBooking(h);
    await h.t.run(async (ctx) => logUsage(ctx, { agentSlug: "support", model: "claude-haiku-4-5", provider: "anthropic", origin: "customer", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } }));
    const keys = monthKeysBack(6);
    expect(keys).toHaveLength(6);
    expect(keys[5]).toMatch(/^\d{4}-\d{2}$/);
    const { points } = await h.t.run(async (ctx) => monthlySeries(ctx, 6));
    expect(points.map((p) => p.monthKey)).toEqual(keys);
    const last = points[5];
    expect(last).toMatchObject({ inquiries: 1, newLeads: 1, wonLeads: 1, bookings: 1, revenueOmr: 300 });
    expect(last.agentCostUsd).toBeGreaterThan(0);
    expect(points.slice(0, 5).every((p) => p.inquiries === 0 && p.bookings === 0)).toBe(true);
  });

  it("measures support response time, escalation and auto-reply share", async () => {
    const h = await setup();
    const a = await inboundMessage(h, "استفسار", "ig-a");
    const b = await inboundMessage(h, "شكوى", "ig-b");
    const now = Date.now();
    await h.t.run(async (ctx) => ctx.db.patch(a.interactionId, { status: "REPLIED", sentAt: now + 30 * 60_000, aiClassification: { kind: "INQUIRY", confidence: 0.9, model: "m", escalated: false }, kind: "INQUIRY" }));
    await h.t.run(async (ctx) => ctx.db.patch(b.interactionId, { status: "REPLIED", sentAt: now + 90 * 60_000, aiClassification: { kind: "COMPLAINT", confidence: 0.9, model: "m", escalated: true, escalationReason: "complaint" }, kind: "COMPLAINT" }));
    await h.t.run(async (ctx) => createApproval(ctx, AGENT("support"), { kind: "SEND_CUSTOMER_MESSAGE", agentSlug: "support", title: "r", summary: "s", payload: { interactionId: a.interactionId }, severity: "D3" }));
    const r = await h.t.run(async (ctx) => supportReport(ctx, { days: 30 }));
    expect(r.inbound).toBe(2);
    expect(r.byChannel.INSTAGRAM).toBe(2);
    expect(r.byKind).toEqual({ INQUIRY: 1, COMPLAINT: 1 });
    expect(r.responded).toBe(2);
    expect(r.avgResponseMinutes).toBe(60);
    expect(r.medianResponseMinutes).toBe(90);
    expect(r.escalationRatePercent).toBe(50);
    expect(r.complaints).toBe(1);
    expect(r.messageApprovals).toMatchObject({ decided: 0, auto: 0 });
    expect(r.openNow).toEqual({ NEW: 0, REPLY_PROPOSED: 0, ESCALATED: 0 });
  });

  it("aggregates agent performance, cost projection and bookings by product", async () => {
    const h = await setup();
    const { taskId } = await h.asOwner.mutation(api.chat.send, { message: "ما مؤشرات هذا الشهر؟" });
    await h.t.action(internal.agents.loop.run, { taskId });
    const perf = await h.t.run(async (ctx) => agentPerformance(ctx));
    const exec = perf.rows.find((r) => r.agentSlug === "executive")!;
    expect(exec.tasks).toBe(1);
    expect(exec.completed).toBe(1);
    expect(exec.byOrigin.owner).toBe(1);
    expect(exec.unsupportedFactRatePercent).toBeNull();

    // The mock model is free; add one priced call so totals and the projection are exercised.
    await h.t.run(async (ctx) => logUsage(ctx, { agentSlug: "executive", model: "claude-sonnet-5", provider: "anthropic", origin: "owner", usage: { inputTokens: 2000, outputTokens: 500, cacheReadTokens: 1000, cacheWriteTokens: 0 } }));
    const cost = await h.t.run(async (ctx) => costReport(ctx));
    expect(cost.byDay).toHaveLength(cost.daysInMonth);
    expect(cost.totalUsd).toBeGreaterThan(0);
    expect(cost.projectedUsd).toBeGreaterThanOrEqual(cost.totalUsd);
    // The executive agent's own calls are billed under origin "executive"; the priced row above is "owner".
    expect(cost.byOrigin.executive?.calls).toBeGreaterThan(0);
    expect(cost.byOrigin.owner?.calls).toBe(1);
    expect(cost.byDay.reduce((s, d) => s + d.calls, 0)).toBe((cost.byOrigin.executive?.calls ?? 0) + (cost.byOrigin.owner?.calls ?? 0));
    expect(cost.cacheReadSharePercent).toBeGreaterThan(0);

    await confirmedBooking(h);
    const bookings = await h.t.run(async (ctx) => bookingsReport(ctx));
    expect(bookings.total).toBe(1);
    expect(bookings.byStatus.CONFIRMED).toBe(1);
    expect(bookings.byProduct[0]).toMatchObject({ productId: null, bookings: 1, revenueOmr: 300 });
    expect(bookings.upcoming).toHaveLength(1);
    expect(bookings.departuresByMonth.reduce((s, d) => s + d.departures, 0)).toBe(1);
    // Public API is guarded.
    await expect(h.t.query(api.reports.cost, {})).rejects.toThrow(/UNAUTHENTICATED|يجب تسجيل الدخول/);
    expect((await h.asStaff.query(api.reports.series, { months: 3 })).points).toHaveLength(3);
  });

  it("lets the executive read reports through get_report while specialists stay in their domain", async () => {
    const h = await setup();
    const { executeTool } = await import("../../convex/agents/tools");
    const agent = await h.t.run(async (ctx) => (await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", "executive")).unique())!);
    const product = await h.t.run(async (ctx) => (await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", "product")).unique())!);
    const taskId = await h.t.run(async (ctx) =>
      ctx.db.insert("tasks", { businessId: "TSK-T", title: "t", request: "t", origin: "owner", requestedBy: { type: "owner", id: h.ownerId }, agentSlug: "executive", status: "RUNNING", priority: "NORMAL", cancelRequested: false, stepCount: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, contextRefs: { customerIds: [], leadIds: [], productIds: [], bookingIds: [] }, citations: [], feedback: [] }),
    );
    const task = (await h.t.run(async (ctx) => ctx.db.get(taskId)))!;
    const ok = await h.t.run(async (ctx) => executeTool(ctx, task, agent, "get_report", { kind: "cost" }));
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse(ok.content).monthKey).toMatch(/^\d{4}-\d{2}$/);
    const denied = await h.t.run(async (ctx) => executeTool(ctx, task, product, "get_report", { kind: "cost" }));
    expect(denied.isError).toBe(true);
  });
});

describe("Phase 4 — lifecycle follow-ups auto-approval end to end", () => {
  it("sends selected follow-up kinds without the owner and leaves the rest pending", async () => {
    const h = await setup();
    await disableQuietHours(h);
    await h.asOwner.mutation(api.settings.update, { key: "autoApprove", value: { followUpKinds: ["WELCOME"] } });
    const { bookingId } = await confirmedBooking(h);
    const booking = (await h.t.run(async (ctx) => ctx.db.get(bookingId)))!;
    const now = Date.now();
    await h.t.run(async (ctx) => scheduleFollowUpsForBooking(ctx, booking, now));
    await h.t.run(async (ctx) => processDueFollowUps(ctx, now));
    const welcome = (await h.t.run(async (ctx) => ctx.db.query("followUps").withIndex("by_booking_kind", (q) => q.eq("bookingId", bookingId).eq("kind", "WELCOME")).unique()))!;
    const approval = (await h.t.run(async (ctx) => ctx.db.get(welcome.approvalId!)))!;
    expect(approval.status).toBe("APPROVED");
    expect(approval.decidedBy?.id).toBe(AUTO_RULE_ACTOR_ID);
    await h.t.action(internal.approvals.execute, { approvalId: approval._id });
    expect((await h.t.run(async (ctx) => ctx.db.get(welcome._id)))?.status).toBe("SENT");
    // Reminder is due a week later and is not in the auto list → pending for the owner.
    await h.t.run(async (ctx) => processDueFollowUps(ctx, now + 8 * DAY));
    const reminder = (await h.t.run(async (ctx) => ctx.db.query("followUps").withIndex("by_booking_kind", (q) => q.eq("bookingId", bookingId).eq("kind", "PRE_TRIP_REMINDER")).unique()))!;
    expect(reminder.status).toBe("PENDING_APPROVAL");
    expect((await h.t.run(async (ctx) => ctx.db.get(reminder.approvalId!)))?.status).toBe("PENDING");
  });
});
