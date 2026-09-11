import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { describeRule, nextOccurrence, zonedToUtc } from "../../convex/lib/schedule";
import { runDueCustomSchedules } from "../../convex/services/customSchedules";
import { emergencyStop } from "../../convex/services/tasks";
import { OWNER_ACTOR, setup } from "./helpers";

const TZ = "Asia/Muscat"; // UTC+4, no DST
const DAY = 86_400_000;
const WEEK = 7 * DAY;

// 2026-09-11 is a Friday, 2026-09-13 a Sunday.
const friday10 = zonedToUtc(2026, 9, 11, 10, 0, TZ);
const sunday10 = zonedToUtc(2026, 9, 13, 10, 0, TZ);

const weeklyInput = {
  title: "تقرير الأحد",
  agentSlug: "executive",
  request: "أعدّ ملخصاً أسبوعياً للمالك عن خط المبيعات والحجوزات القادمة.",
  frequency: "WEEKLY",
  dayOfWeek: 0,
  hour: 8,
  minute: 30,
};

describe("Custom schedules — timezone math", () => {
  it("converts a Muscat wall-clock time to UTC", () => {
    expect(zonedToUtc(2026, 9, 13, 8, 30, TZ)).toBe(Date.UTC(2026, 8, 13, 4, 30));
  });

  it("computes the next occurrence strictly after now for every frequency", () => {
    expect(nextOccurrence({ frequency: "DAILY", hour: 8, minute: 30 }, sunday10, TZ)).toBe(zonedToUtc(2026, 9, 14, 8, 30, TZ));
    expect(nextOccurrence({ frequency: "DAILY", hour: 11, minute: 0 }, sunday10, TZ)).toBe(zonedToUtc(2026, 9, 13, 11, 0, TZ));
    expect(nextOccurrence({ frequency: "WEEKLY", dayOfWeek: 0, hour: 8, minute: 30 }, friday10, TZ)).toBe(zonedToUtc(2026, 9, 13, 8, 30, TZ));
    expect(nextOccurrence({ frequency: "WEEKLY", dayOfWeek: 0, hour: 8, minute: 30 }, sunday10, TZ)).toBe(zonedToUtc(2026, 9, 20, 8, 30, TZ));
    expect(nextOccurrence({ frequency: "MONTHLY", dayOfMonth: 1, hour: 8, minute: 30 }, sunday10, TZ)).toBe(zonedToUtc(2026, 10, 1, 8, 30, TZ));
    expect(nextOccurrence({ frequency: "MONTHLY", dayOfMonth: 13, hour: 8, minute: 30 }, sunday10, TZ)).toBe(zonedToUtc(2026, 10, 13, 8, 30, TZ));
    expect(nextOccurrence({ frequency: "ONCE", hour: 0, minute: 0, runAt: sunday10 - 1 }, sunday10, TZ)).toBeNull();
    expect(nextOccurrence({ frequency: "ONCE", hour: 0, minute: 0, runAt: sunday10 + 1 }, sunday10, TZ)).toBe(sunday10 + 1);
  });

  it("describes rules in both languages", () => {
    expect(describeRule({ frequency: "WEEKLY", dayOfWeek: 0, hour: 8, minute: 5 }, "ar")).toBe("كل الأحد 08:05");
    expect(describeRule({ frequency: "MONTHLY", dayOfMonth: 3, hour: 18, minute: 0 }, "en")).toBe("Day 3 of every month at 18:00");
  });
});

describe("Custom schedules — owner CRUD and cron firing", () => {
  it("only the owner may create schedules, and input is validated", async () => {
    const h = await setup();
    await expect(h.asStaff.mutation(api.customSchedules.create, weeklyInput)).rejects.toThrow(/FORBIDDEN|المالك/);
    await expect(h.asOwner.mutation(api.customSchedules.create, { ...weeklyInput, request: "قصير" })).rejects.toThrow(/VALIDATION|request/);
    await expect(h.asOwner.mutation(api.customSchedules.create, { ...weeklyInput, dayOfWeek: undefined })).rejects.toThrow(/VALIDATION|dayOfWeek/);
    await expect(h.asOwner.mutation(api.customSchedules.create, { ...weeklyInput, frequency: "ONCE", runAt: Date.now() - 1000 })).rejects.toThrow(/VALIDATION|runAt/);
    await expect(h.asOwner.mutation(api.customSchedules.create, { ...weeklyInput, agentSlug: "finance" })).rejects.toThrow(/VALIDATION|agentSlug/);
  });

  it("fires a due weekly schedule as a system task, advances a week and notifies the owner on completion", async () => {
    const h = await setup();
    const created = await h.asOwner.mutation(api.customSchedules.create, weeklyInput);
    expect(created.businessId).toMatch(/^SCH-/);
    expect(created.nextRunAt).toBeGreaterThan(Date.now());
    const firstRun = created.nextRunAt!;

    // Nothing is due yet.
    expect(await h.t.run(async (ctx) => runDueCustomSchedules(ctx, firstRun - 60_000))).toEqual({ fired: 0, skipped: 0 });
    // The cron tick after the slot fires exactly once.
    expect(await h.t.run(async (ctx) => runDueCustomSchedules(ctx, firstRun + 60_000))).toEqual({ fired: 1, skipped: 0 });

    const schedule = (await h.t.run(async (ctx) => ctx.db.get(created.id)))!;
    expect(schedule.runCount).toBe(1);
    expect(schedule.lastTaskId).toBeTruthy();
    expect(schedule.nextRunAt).toBe(firstRun + WEEK);

    const task = (await h.t.run(async (ctx) => ctx.db.get(schedule.lastTaskId!)))!;
    expect(task).toMatchObject({ origin: "system", agentSlug: "executive", priority: "NORMAL", requestedBy: { type: "system", id: `cron:custom:${created.businessId}` } });
    expect(task.request).toContain(weeklyInput.request);

    await h.t.action(internal.agents.loop.run, { taskId: task._id });
    const done = (await h.t.run(async (ctx) => ctx.db.get(task._id)))!;
    expect(done.status).toBe("COMPLETED");
    const note = await h.t.run(async (ctx) => (await ctx.db.query("notifications").take(50)).find((n) => n.kind === "SCHEDULED_TASK_DONE" && n.relatedRecordId === task._id));
    expect(note).toBeTruthy();

    const listed = await h.asOwner.query(api.customSchedules.list, {});
    expect(listed).toHaveLength(1);
    expect(listed[0].lastTask?.status).toBe("COMPLETED");
  });

  it("retires ONCE schedules after their slot and records skips under the emergency stop", async () => {
    const h = await setup();
    const runAt = Date.now() + DAY;
    const created = await h.asOwner.mutation(api.customSchedules.create, { ...weeklyInput, title: "مرة واحدة", frequency: "ONCE", runAt });
    expect(created.nextRunAt).toBe(runAt);
    await h.t.run(async (ctx) => emergencyStop(ctx, OWNER_ACTOR(h.ownerId), "اختبار"));
    expect(await h.t.run(async (ctx) => runDueCustomSchedules(ctx, runAt + 1))).toEqual({ fired: 0, skipped: 1 });
    const schedule = (await h.t.run(async (ctx) => ctx.db.get(created.id)))!;
    expect(schedule).toMatchObject({ enabled: false, lastSkipReason: "emergency_stop", runCount: 0 });
    expect(schedule.nextRunAt).toBeUndefined();
    expect(schedule.lastTaskId).toBeUndefined();
  });

  it("supports run-now, update, enable/disable and delete with audit rows", async () => {
    const h = await setup();
    const created = await h.asOwner.mutation(api.customSchedules.create, weeklyInput);

    await expect(h.asStaff.mutation(api.customSchedules.runNow, { id: created.id })).rejects.toThrow(/FORBIDDEN|المالك/);
    const manual = await h.asOwner.mutation(api.customSchedules.runNow, { id: created.id });
    expect(manual.taskId).toBeTruthy();
    const manualTask = (await h.t.run(async (ctx) => ctx.db.get(manual.taskId!)))!;
    expect(manualTask.request).toContain("تشغيل يدوي");
    // A manual run leaves the cadence untouched.
    expect((await h.t.run(async (ctx) => ctx.db.get(created.id)))!.nextRunAt).toBe(created.nextRunAt);

    const updated = await h.asOwner.mutation(api.customSchedules.update, { id: created.id, ...weeklyInput, frequency: "DAILY", dayOfWeek: undefined, hour: 6, minute: 0, priority: "HIGH" });
    expect(updated.nextRunAt).toBeGreaterThan(Date.now());
    expect(updated.nextRunAt! - Date.now()).toBeLessThanOrEqual(DAY);
    expect((await h.t.run(async (ctx) => ctx.db.get(created.id)))!).toMatchObject({ frequency: "DAILY", hour: 6, priority: "HIGH" });
    expect((await h.t.run(async (ctx) => ctx.db.get(created.id)))!.dayOfWeek).toBeUndefined();

    await h.asOwner.mutation(api.customSchedules.setEnabled, { id: created.id, enabled: false });
    expect((await h.t.run(async (ctx) => ctx.db.get(created.id)))!.enabled).toBe(false);
    // Disabled schedules are never picked up by the cron.
    expect(await h.t.run(async (ctx) => runDueCustomSchedules(ctx, Date.now() + 2 * DAY))).toEqual({ fired: 0, skipped: 0 });
    await h.asOwner.mutation(api.customSchedules.setEnabled, { id: created.id, enabled: true });
    const reenabled = (await h.t.run(async (ctx) => ctx.db.get(created.id)))!;
    expect(reenabled.enabled).toBe(true);
    expect(reenabled.nextRunAt).toBeGreaterThan(Date.now());

    await expect(h.asStaff.mutation(api.customSchedules.remove, { id: created.id })).rejects.toThrow(/FORBIDDEN|المالك/);
    await h.asOwner.mutation(api.customSchedules.remove, { id: created.id });
    expect(await h.t.run(async (ctx) => ctx.db.get(created.id))).toBeNull();

    const audit = await h.t.run(async (ctx) => (await ctx.db.query("auditLog").take(200)).filter((a) => a.table === "customSchedules"));
    const events = audit.map((a) => a.event);
    expect(events).toEqual(expect.arrayContaining(["CREATE", "SYSTEM", "UPDATE", "ARCHIVE"]));
    expect(audit.every((a) => a.businessId === created.businessId)).toBe(true);
  });
});

describe("Settings — owner edits user profiles", () => {
  it("updates name, phone, locale and moves the sign-in account when the e-mail changes (D4)", async () => {
    const h = await setup();
    const accountId = await h.t.run(async (ctx) => ctx.db.insert("authAccounts", { userId: h.staffId, provider: "password", providerAccountId: "staff@test.om" }));

    await expect(h.asStaff.mutation(api.settings.updateUser, { userId: h.staffId, name: "x" })).rejects.toThrow(/FORBIDDEN|المالك/);
    await expect(h.asOwner.mutation(api.settings.updateUser, { userId: h.staffId, phone: "12" })).rejects.toThrow(/VALIDATION|phone/);
    await expect(h.asOwner.mutation(api.settings.updateUser, { userId: h.staffId, locale: "fr" })).rejects.toThrow(/VALIDATION|locale/);
    await expect(h.asOwner.mutation(api.settings.updateUser, { userId: h.staffId, email: "not-an-email" })).rejects.toThrow(/VALIDATION|email/);
    await expect(h.asOwner.mutation(api.settings.updateUser, { userId: h.staffId, email: "owner@test.om" })).rejects.toThrow(/DUPLICATE|بريد/);

    await h.asOwner.mutation(api.settings.updateUser, { userId: h.staffId, name: "سالم الهنائي", phone: "+968 91234567", locale: "en" });
    const afterProfile = (await h.t.run(async (ctx) => ctx.db.get(h.staffId)))!;
    expect(afterProfile).toMatchObject({ name: "سالم الهنائي", phone: "+968 91234567", locale: "en", email: "staff@test.om" });
    const profileAudit = await h.t.run(async (ctx) => (await ctx.db.query("auditLog").take(200)).filter((a) => a.table === "users" && a.recordId === h.staffId));
    expect(profileAudit.at(-1)?.severity).toBe("D2");

    await h.asOwner.mutation(api.settings.updateUser, { userId: h.staffId, email: "  Salim@Test.om " });
    const afterEmail = (await h.t.run(async (ctx) => ctx.db.get(h.staffId)))!;
    expect(afterEmail.email).toBe("salim@test.om");
    const account = (await h.t.run(async (ctx) => ctx.db.get(accountId)))!;
    expect(account.providerAccountId).toBe("salim@test.om");
    const emailAudit = await h.t.run(async (ctx) => (await ctx.db.query("auditLog").take(200)).filter((a) => a.table === "users" && a.recordId === h.staffId));
    expect(emailAudit.at(-1)?.severity).toBe("D4");
    expect(emailAudit.at(-1)?.oldValue).toMatchObject({ email: "staff@test.om" });

    const users = await h.asOwner.query(api.settings.listUsers, {});
    const staff = users.find((u: { _id: Id<"users"> }) => u._id === h.staffId)!;
    expect(staff).toMatchObject({ email: "salim@test.om", phone: "+968 91234567", locale: "en" });
  });
});
