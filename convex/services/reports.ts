/**
 * Read models for KPIs and sales reporting. Everything here is computed from the
 * database (section 3.1: the executive answers KPI questions from data, never
 * from estimates). Definitions live in docs/KPI_DICTIONARY.md.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { monthKey } from "../lib/settings";
import { monthlyUsage } from "./usage";

type Ctx = QueryCtx | MutationCtx;

export async function computeKpis(ctx: Ctx, month?: string) {
  const key = month ?? monthKey();
  const [y, m] = key.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1);
  const inRange = (t: number) => t >= start && t < end;
  const interactions = await ctx.db.query("interactions").withIndex("by_receivedAt", (q) => q.gte("receivedAt", start).lt("receivedAt", end)).take(5000);
  const leads = (await ctx.db.query("leads").take(5000)).filter((l) => !l.archivedAt);
  const leadsThisMonth = leads.filter((l) => inRange(l.createdAt));
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
  const bookings = (await ctx.db.query("bookings").take(5000)).filter((b) => !b.archivedAt && inRange(b.createdAt));
  const revenueOmr = bookings.filter((b) => ["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(b.status)).reduce((s, b) => s + b.totalSellingPrice.baseAmount, 0);
  const quotes = (await ctx.db.query("quotes").take(5000)).filter((q) => !q.archivedAt && inRange(q.createdAt));
  const usage = await monthlyUsage(ctx, key);
  const inbound = interactions.filter((i) => i.direction === "INBOUND").length;
  const qualified = leadsThisMonth.filter((l) => l.stage !== "NEW_LEAD").length;
  const won = leadsThisMonth.filter((l) => l.stage === "WON").length;
  const paidBookings = bookings.filter((b) => b.paymentStatus === "PAID" || b.paymentStatus === "DEPOSIT_PAID" || b.paymentStatus === "PARTIALLY_PAID").length;
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);
  return {
    monthKey: key,
    inquiries: inbound,
    newLeads: leadsThisMonth.length,
    leadsByStage: byStage,
    quotesSent: quotes.filter((q) => ["SENT", "ACCEPTED"].includes(q.status)).length,
    bookings: bookings.length,
    bookingsByStatus: bookings.reduce<Record<string, number>>((acc, b) => ((acc[b.status] = (acc[b.status] ?? 0) + 1), acc), {}),
    revenueOmr: Math.round(revenueOmr * 1000) / 1000,
    agentCostUsd: usage.totalUsd,
    budgetUsd: usage.budgetUsd,
    conversion: {
      inquiryToLeadPercent: pct(leadsThisMonth.length, inbound),
      leadToQuotePercent: pct(quotes.length, leadsThisMonth.length),
      quoteToBookingPercent: pct(bookings.length, quotes.length),
      paidBookingsOverQualifiedLeadsPercent: pct(paidBookings, qualified),
      wonLeadsPercent: pct(won, leadsThisMonth.length),
    },
    source: { kind: "db" as const, retrievedAt: Date.now() },
  };
}

export interface PipelineReport {
  generatedAt: number;
  byStage: { stage: string; count: number; expectedValueOmr: number }[];
  totalOpenExpectedValueOmr: number;
  staleLeads: { _id: string; businessId: string; contactName: string; stage: string; lastContactAt?: number; daysSinceContact: number | null }[];
  overdueFollowUps: { _id: string; businessId: string; contactName: string; stage: string; nextFollowUpAt: number }[];
  quotesExpiringSoon: { _id: string; businessId: string; leadId: string; validUntil?: number; status: string }[];
  lostReasons: Record<string, number>;
  conversion: Awaited<ReturnType<typeof computeKpis>>["conversion"];
  source: { kind: "db"; retrievedAt: number };
}

/** Sales pipeline health: stage funnel, stale leads, overdue follow-ups, expiring quotes (section 3.3). */
export async function pipelineReport(ctx: Ctx, opts: { staleDays?: number } = {}): Promise<PipelineReport> {
  const now = Date.now();
  const staleMs = (opts.staleDays ?? 7) * 24 * 60 * 60 * 1000;
  const leads = (await ctx.db.query("leads").take(5000)).filter((l) => !l.archivedAt);
  const open = leads.filter((l) => l.stage !== "WON" && l.stage !== "LOST");
  const stages = new Map<string, { count: number; expectedValueOmr: number }>();
  for (const l of leads) {
    const s = stages.get(l.stage) ?? { count: 0, expectedValueOmr: 0 };
    s.count += 1;
    s.expectedValueOmr += l.expectedValue?.baseAmount ?? 0;
    stages.set(l.stage, s);
  }
  const lostReasons: Record<string, number> = {};
  for (const l of leads) if (l.stage === "LOST" && l.lostReason) lostReasons[l.lostReason] = (lostReasons[l.lostReason] ?? 0) + 1;
  const quotes = (await ctx.db.query("quotes").take(2000)).filter((q) => !q.archivedAt);
  const kpis = await computeKpis(ctx);
  return {
    generatedAt: now,
    byStage: [...stages.entries()].map(([stage, s]) => ({ stage, count: s.count, expectedValueOmr: Math.round(s.expectedValueOmr * 1000) / 1000 })),
    totalOpenExpectedValueOmr: Math.round(open.reduce((s, l) => s + (l.expectedValue?.baseAmount ?? 0), 0) * 1000) / 1000,
    staleLeads: open
      .filter((l) => (l.lastContactAt ?? l.createdAt) < now - staleMs)
      .map((l) => ({ _id: l._id, businessId: l.businessId, contactName: l.contactName, stage: l.stage, lastContactAt: l.lastContactAt, daysSinceContact: l.lastContactAt ? Math.floor((now - l.lastContactAt) / 86_400_000) : null }))
      .slice(0, 50),
    overdueFollowUps: open
      .filter((l) => l.nextFollowUpAt !== undefined && l.nextFollowUpAt < now)
      .map((l) => ({ _id: l._id, businessId: l.businessId, contactName: l.contactName, stage: l.stage, nextFollowUpAt: l.nextFollowUpAt! }))
      .slice(0, 50),
    quotesExpiringSoon: quotes
      .filter((q) => q.status === "SENT" && q.validUntil !== undefined && q.validUntil > now && q.validUntil < now + 3 * 86_400_000)
      .map((q) => ({ _id: q._id, businessId: q.businessId, leadId: q.leadId, validUntil: q.validUntil, status: q.status })),
    lostReasons,
    conversion: kpis.conversion,
    source: { kind: "db", retrievedAt: now },
  };
}
