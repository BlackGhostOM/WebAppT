/**
 * Post-sale follow-ups (section 3.4): welcome after confirmation, reminder
 * three days before travel, satisfaction survey two days after return.
 *
 * The daily cron schedules them from confirmed bookings and, when due, turns
 * each into a SEND_CUSTOMER_MESSAGE approval. Nothing reaches the customer
 * before the owner approves (or an owner-enabled auto-approval rule applies).
 * Templates never mention prices; they only restate facts from the booking.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { systemActor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { nextBusinessId } from "../lib/ids";
import { getSetting } from "../lib/settings";
import * as V from "../lib/vocab";
import { createApproval } from "./approvals";

const DAY = 24 * 60 * 60 * 1000;
export const REMINDER_DAYS_BEFORE = 3;
export const SURVEY_DAYS_AFTER = 2;
/** Bookings confirmed longer ago than this never get a late welcome message. */
const WELCOME_MAX_AGE = 14 * DAY;

const ACTOR = systemActor("cron:followUps");

function formatDay(ts: number, language: "ar" | "en", timezone: string): string {
  try {
    return new Intl.DateTimeFormat(language === "ar" ? "ar-OM" : "en-GB", { dateStyle: "long", timeZone: timezone }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

export interface FollowUpTemplateInput {
  kind: V.FollowUpKind;
  language: "ar" | "en";
  customerName: string;
  companyName: string;
  bookingId: string;
  productName?: string;
  travelDateFrom: number;
  travelDateTo: number;
  timezone: string;
}

export function buildFollowUpMessage(input: FollowUpTemplateInput): string {
  const from = formatDay(input.travelDateFrom, input.language, input.timezone);
  const to = formatDay(input.travelDateTo, input.language, input.timezone);
  const trip = input.productName ? `«${input.productName}»` : input.language === "ar" ? "رحلتكم" : "your trip";
  if (input.language === "en") {
    switch (input.kind) {
      case "WELCOME":
        return `Dear ${input.customerName},\n\nThank you for choosing ${input.companyName}. Your booking ${input.bookingId} for ${trip} (${from} – ${to}) is confirmed. Our team is here for any question before you travel.\n\n${input.companyName}`;
      case "PRE_TRIP_REMINDER":
        return `Dear ${input.customerName},\n\nA friendly reminder that ${trip} starts on ${from} (booking ${input.bookingId}). Please check your documents and the departure details. We wish you a wonderful journey.\n\n${input.companyName}`;
      case "SATISFACTION_SURVEY":
        return `Dear ${input.customerName},\n\nWe hope you enjoyed ${trip} (booking ${input.bookingId}). How would you rate your experience from 1 to 5, and what could we do better? Your feedback shapes our next trips.\n\n${input.companyName}`;
    }
  }
  switch (input.kind) {
    case "WELCOME":
      return `عزيزنا ${input.customerName}،\n\nشكراً لاختياركم ${input.companyName}. تم تأكيد حجزكم ${input.bookingId} لـ${trip} من ${from} إلى ${to}. فريقنا في خدمتكم لأي استفسار قبل الرحلة.\n\n${input.companyName}`;
    case "PRE_TRIP_REMINDER":
      return `عزيزنا ${input.customerName}،\n\nنذكّركم بأن ${trip} تبدأ يوم ${from} (الحجز ${input.bookingId}). يرجى التأكد من المستندات وتفاصيل الانطلاق. نتمنى لكم رحلة ممتعة.\n\n${input.companyName}`;
    case "SATISFACTION_SURVEY":
      return `عزيزنا ${input.customerName}،\n\nنأمل أن ${trip} (الحجز ${input.bookingId}) كانت ممتعة. كيف تقيّمون تجربتكم من 1 إلى 5؟ وما الذي يمكننا تحسينه؟ رأيكم يصنع رحلاتنا القادمة.\n\n${input.companyName}`;
  }
}

/** Channel a service message can legitimately use; Instagram only inside the 24h reply window. */
export function pickFollowUpChannel(customer: Doc<"customers">): Doc<"interactions">["channel"] | null {
  if (customer.normalizedPhone) return "WHATSAPP";
  if (customer.normalizedEmail) return "EMAIL";
  if (customer.preferredChannel && customer.preferredChannel !== "INSTAGRAM" && customer.preferredChannel !== "WALK_IN" && customer.preferredChannel !== "REFERRAL") return customer.preferredChannel;
  return null;
}

/** Plans the three lifecycle messages for a booking; idempotent per (booking, kind). */
export async function scheduleFollowUpsForBooking(ctx: MutationCtx, booking: Doc<"bookings">, now: number = Date.now()): Promise<number> {
  if (booking.archivedAt) return 0;
  if (!["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(booking.status)) return 0;
  const customer = await ctx.db.get(booking.customerId);
  if (!customer || customer.archivedAt) return 0;
  const existing = await ctx.db.query("followUps").withIndex("by_booking_kind", (q) => q.eq("bookingId", booking._id)).take(10);
  const have = new Set(existing.map((f) => f.kind));
  const confirmedAt = booking.confirmedAt ?? booking._creationTime;
  const plan: { kind: V.FollowUpKind; dueAt: number }[] = [];
  if (booking.status === "CONFIRMED" && now - confirmedAt <= WELCOME_MAX_AGE) plan.push({ kind: "WELCOME", dueAt: now });
  const reminderAt = booking.travelDateFrom - REMINDER_DAYS_BEFORE * DAY;
  if (booking.status === "CONFIRMED" && reminderAt >= now - DAY && booking.travelDateFrom > now) plan.push({ kind: "PRE_TRIP_REMINDER", dueAt: Math.max(reminderAt, now) });
  const surveyAt = booking.travelDateTo + SURVEY_DAYS_AFTER * DAY;
  if (surveyAt >= now - WELCOME_MAX_AGE) plan.push({ kind: "SATISFACTION_SURVEY", dueAt: surveyAt });

  let created = 0;
  for (const p of plan) {
    if (have.has(p.kind)) continue;
    const businessId = await nextBusinessId(ctx, "followUps");
    const id = await ctx.db.insert("followUps", {
      businessId,
      bookingId: booking._id,
      customerId: booking.customerId,
      kind: p.kind,
      status: "SCHEDULED",
      dueAt: p.dueAt,
      channel: pickFollowUpChannel(customer) ?? "OTHER",
      language: customer.preferredLanguage,
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, { actor: ACTOR, table: "followUps", recordId: id, businessId, event: "CREATE", newValue: { bookingId: booking.businessId, kind: p.kind, dueAt: p.dueAt }, severity: "D1" });
    created += 1;
  }
  return created;
}

async function setFollowUpStatus(ctx: MutationCtx, followUp: Doc<"followUps">, status: V.FollowUpStatus, extra: Partial<Doc<"followUps">> = {}, reason?: string) {
  await ctx.db.patch(followUp._id, { status, ...extra, updatedAt: Date.now() });
  await appendAudit(ctx, { actor: ACTOR, table: "followUps", recordId: followUp._id, businessId: followUp.businessId, event: "UPDATE", oldValue: { status: followUp.status }, newValue: { status }, reason, severity: "D1", approvalId: extra.approvalId ?? followUp.approvalId });
}

/** Turns due follow-ups into approvals (or skips them when they can no longer be sent). */
export async function processDueFollowUps(ctx: MutationCtx, now: number = Date.now()): Promise<{ proposed: number; skipped: number; cancelled: number }> {
  const due = await ctx.db.query("followUps").withIndex("by_status_dueAt", (q) => q.eq("status", "SCHEDULED").lte("dueAt", now)).take(100);
  const company = await getSetting(ctx, "company");
  let proposed = 0;
  let skipped = 0;
  let cancelled = 0;
  for (const followUp of due) {
    const booking = await ctx.db.get(followUp.bookingId);
    const customer = await ctx.db.get(followUp.customerId);
    if (!booking || booking.archivedAt || booking.status === "CANCELLED" || booking.status === "NO_SHOW") {
      await setFollowUpStatus(ctx, followUp, "CANCELLED", {}, booking ? `booking_${booking.status}` : "booking_missing");
      cancelled += 1;
      continue;
    }
    if (!customer || customer.archivedAt || customer.consentStatus === "WITHDRAWN") {
      await setFollowUpStatus(ctx, followUp, "SKIPPED", { skipReason: "customer_unreachable_or_withdrawn" }, "consent");
      skipped += 1;
      continue;
    }
    const channel = pickFollowUpChannel(customer);
    if (!channel) {
      await setFollowUpStatus(ctx, followUp, "SKIPPED", { skipReason: "no_reachable_channel" }, "channel");
      skipped += 1;
      continue;
    }
    const product = booking.productId ? await ctx.db.get(booking.productId) : null;
    const language = customer.preferredLanguage;
    const message = buildFollowUpMessage({
      kind: followUp.kind,
      language,
      customerName: customer.fullName,
      companyName: language === "ar" ? company.name : company.nameEn,
      bookingId: booking.businessId,
      productName: product ? (language === "en" && product.nameEn ? product.nameEn : product.name) : undefined,
      travelDateFrom: booking.travelDateFrom,
      travelDateTo: booking.travelDateTo,
      timezone: company.timezone,
    });
    const { approvalId } = await createApproval(ctx, ACTOR, {
      kind: "SEND_CUSTOMER_MESSAGE",
      agentSlug: "support",
      title: `${labelKind(followUp.kind)}: ${customer.fullName} (${booking.businessId})`,
      summary: `رسالة ما بعد البيع (${followUp.kind}) عبر ${channel} بلغة ${language}. الحجز ${booking.businessId} بحالة ${booking.status}.`,
      payload: { followUpId: followUp._id, bookingId: booking._id, customerId: customer._id, channel, message, purpose: followUp.kind, classification: "FOLLOW_UP", language },
      toolName: "lifecycle_follow_up",
      targetTable: "followUps",
      targetRecordId: followUp._id,
      severity: "D3",
    });
    await setFollowUpStatus(ctx, followUp, "PENDING_APPROVAL", { approvalId, message, channel, language });
    proposed += 1;
  }
  return { proposed, skipped, cancelled };
}

function labelKind(kind: V.FollowUpKind): string {
  return kind === "WELCOME" ? "رسالة ترحيب" : kind === "PRE_TRIP_REMINDER" ? "تذكير قبل الرحلة" : "استطلاع الرضا";
}

/** Daily job: plan from bookings, then propose what is due. */
export async function runFollowUps(ctx: MutationCtx, now: number = Date.now()) {
  let scheduled = 0;
  for (const status of ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const) {
    const bookings = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", status)).take(2000);
    for (const booking of bookings) scheduled += await scheduleFollowUpsForBooking(ctx, booking, now);
  }
  const processed = await processDueFollowUps(ctx, now);
  await appendAudit(ctx, { actor: ACTOR, table: "settings", recordId: "followUps", event: "SYSTEM", newValue: { scheduled, ...processed }, severity: "D1" });
  return { scheduled, ...processed };
}

/** Called by the approval executor once the message went out. */
export async function markFollowUpSent(ctx: MutationCtx, followUpId: Id<"followUps">, interactionId: Id<"interactions">) {
  const followUp = await ctx.db.get(followUpId);
  if (!followUp) return;
  await setFollowUpStatus(ctx, followUp, "SENT", { interactionId, sentAt: Date.now() });
}

/** Called when the owner rejects the generated message. */
export async function markFollowUpSkipped(ctx: MutationCtx, followUpId: Id<"followUps">, reason: string) {
  const followUp = await ctx.db.get(followUpId);
  if (!followUp || followUp.status === "SENT") return;
  await setFollowUpStatus(ctx, followUp, "SKIPPED", { skipReason: reason }, reason);
}
