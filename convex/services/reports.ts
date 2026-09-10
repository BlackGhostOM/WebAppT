/**
 * Read models for KPIs and sales reporting. Everything here is computed from the
 * database (section 3.1: the executive answers KPI questions from data, never
 * from estimates). Definitions live in docs/KPI_DICTIONARY.md.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getSetting, monthKey } from "../lib/settings";
import { AUTO_RULE_ACTOR_ID } from "./approvals";
import { monthlyUsage } from "./usage";

type Ctx = QueryCtx | MutationCtx;

const DAY = 24 * 60 * 60 * 1000;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);

function monthBounds(key: string): { start: number; end: number } {
  const [y, m] = key.split("-").map(Number);
  return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) };
}

/** Oldest → newest month keys ending with the month containing `now`. */
export function monthKeysBack(months: number, now: number = Date.now()): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) out.push(monthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)));
  return out;
}

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

// ---------------------------------------------------------------------------
// Phase 4 reports
// ---------------------------------------------------------------------------
export interface MonthPoint {
  monthKey: string;
  inquiries: number;
  newLeads: number;
  wonLeads: number;
  quotes: number;
  bookings: number;
  revenueOmr: number;
  agentCostUsd: number;
}

/** One pass over leads/bookings/quotes bucketed by month; interactions and usage via their indexes. */
export async function monthlySeries(ctx: Ctx, months = 6, now: number = Date.now()): Promise<{ points: MonthPoint[]; source: { kind: "db"; retrievedAt: number } }> {
  const keys = monthKeysBack(Math.min(Math.max(months, 1), 24), now);
  const index = new Map(keys.map((k, i) => [k, i]));
  const points: MonthPoint[] = keys.map((k) => ({ monthKey: k, inquiries: 0, newLeads: 0, wonLeads: 0, quotes: 0, bookings: 0, revenueOmr: 0, agentCostUsd: 0 }));
  const bucket = (ts: number) => index.get(monthKey(ts));
  for (const l of await ctx.db.query("leads").take(5000)) {
    if (l.archivedAt) continue;
    const i = bucket(l.createdAt);
    if (i === undefined) continue;
    points[i].newLeads += 1;
    if (l.stage === "WON") points[i].wonLeads += 1;
  }
  for (const b of await ctx.db.query("bookings").take(5000)) {
    if (b.archivedAt) continue;
    const i = bucket(b.createdAt);
    if (i === undefined) continue;
    points[i].bookings += 1;
    if (["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(b.status)) points[i].revenueOmr += b.totalSellingPrice.baseAmount;
  }
  for (const q of await ctx.db.query("quotes").take(5000)) {
    if (q.archivedAt) continue;
    const i = bucket(q.createdAt);
    if (i !== undefined && ["SENT", "ACCEPTED"].includes(q.status)) points[i].quotes += 1;
  }
  for (const [i, key] of keys.entries()) {
    const { start, end } = monthBounds(key);
    const inbound = await ctx.db.query("interactions").withIndex("by_receivedAt", (q) => q.gte("receivedAt", start).lt("receivedAt", end)).take(5000);
    points[i].inquiries = inbound.filter((x) => x.direction === "INBOUND").length;
    const usage = await ctx.db.query("usageLog").withIndex("by_month", (q) => q.eq("monthKey", key)).take(5000);
    points[i].agentCostUsd = round(usage.reduce((s, u) => s + u.costUsd, 0), 4);
    points[i].revenueOmr = round(points[i].revenueOmr);
  }
  return { points, source: { kind: "db", retrievedAt: now } };
}

export interface SupportReport {
  days: number;
  inbound: number;
  outbound: number;
  byChannel: Record<string, number>;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
  responded: number;
  avgResponseMinutes: number | null;
  medianResponseMinutes: number | null;
  p90ResponseMinutes: number | null;
  classified: number;
  escalated: number;
  escalationRatePercent: number | null;
  complaints: number;
  messageApprovals: { decided: number; auto: number; rejected: number; edited: number; autoSharePercent: number | null; overrideRatePercent: number | null };
  openNow: { NEW: number; REPLY_PROPOSED: number; ESCALATED: number };
  followUps: Record<string, number>;
  source: { kind: "db"; retrievedAt: number };
}

export async function supportReport(ctx: Ctx, opts: { days?: number } = {}, now: number = Date.now()): Promise<SupportReport> {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const since = now - days * DAY;
  const rows = await ctx.db.query("interactions").withIndex("by_receivedAt", (q) => q.gte("receivedAt", since)).take(5000);
  const inbound = rows.filter((r) => r.direction === "INBOUND");
  const outbound = rows.filter((r) => r.direction === "OUTBOUND");
  const count = <T,>(items: T[], key: (t: T) => string | undefined) => items.reduce<Record<string, number>>((acc, t) => ((acc[key(t) ?? "UNCLASSIFIED"] = (acc[key(t) ?? "UNCLASSIFIED"] ?? 0) + 1), acc), {});
  const responseMinutes = inbound.filter((r) => r.sentAt !== undefined && r.sentAt >= r.receivedAt).map((r) => (r.sentAt! - r.receivedAt) / 60_000).sort((a, b) => a - b);
  const quantile = (p: number) => (responseMinutes.length === 0 ? null : round(responseMinutes[Math.min(responseMinutes.length - 1, Math.floor(p * responseMinutes.length))], 1));
  const classified = inbound.filter((r) => r.aiClassification);
  const escalated = classified.filter((r) => r.aiClassification?.escalated).length;
  const approvals = (await ctx.db.query("approvals").order("desc").take(1000)).filter((a) => a.kind === "SEND_CUSTOMER_MESSAGE" && a.requestedAt >= since);
  const decided = approvals.filter((a) => ["APPROVED", "EXECUTED", "EXECUTION_FAILED", "REJECTED", "EDITED_APPROVED"].includes(a.status));
  const auto = decided.filter((a) => a.decidedBy?.id === AUTO_RULE_ACTOR_ID).length;
  const rejected = decided.filter((a) => a.status === "REJECTED").length;
  const edited = decided.filter((a) => a.status === "EDITED_APPROVED" || (a.editedPayload !== undefined && a.editedPayload !== null)).length;
  const openCount = async (status: Doc<"interactions">["status"]) => (await ctx.db.query("interactions").withIndex("by_status", (q) => q.eq("status", status)).take(500)).filter((i) => i.direction === "INBOUND").length;
  const followUps = count(await ctx.db.query("followUps").order("desc").take(1000), (f) => f.status);
  return {
    days,
    inbound: inbound.length,
    outbound: outbound.length,
    byChannel: count(inbound, (r) => r.channel),
    byKind: count(inbound, (r) => r.kind),
    byStatus: count(inbound, (r) => r.status),
    responded: responseMinutes.length,
    avgResponseMinutes: responseMinutes.length ? round(responseMinutes.reduce((s, m) => s + m, 0) / responseMinutes.length, 1) : null,
    medianResponseMinutes: quantile(0.5),
    p90ResponseMinutes: quantile(0.9),
    classified: classified.length,
    escalated,
    escalationRatePercent: pct(escalated, classified.length),
    complaints: inbound.filter((r) => r.kind === "COMPLAINT").length,
    messageApprovals: { decided: decided.length, auto, rejected, edited, autoSharePercent: pct(auto, decided.length), overrideRatePercent: pct(rejected + edited, decided.length) },
    openNow: { NEW: await openCount("NEW"), REPLY_PROPOSED: await openCount("REPLY_PROPOSED"), ESCALATED: await openCount("ESCALATED") },
    followUps,
    source: { kind: "db", retrievedAt: now },
  };
}

export interface AgentPerformanceRow {
  agentSlug: string;
  tasks: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  avgSteps: number | null;
  avgCostUsd: number | null;
  avgDurationMinutes: number | null;
  unsupportedFactRatePercent: number | null;
  byOrigin: Record<string, number>;
  approvals: { requested: number; approved: number; rejected: number; edited: number; pending: number; overrideRatePercent: number | null };
}

export async function agentPerformance(ctx: Ctx, month: string = monthKey(), now: number = Date.now()): Promise<{ monthKey: string; rows: AgentPerformanceRow[]; source: { kind: "db"; retrievedAt: number } }> {
  const { start, end } = monthBounds(month);
  const tasks = (await ctx.db.query("tasks").order("desc").take(3000)).filter((t) => t._creationTime >= start && t._creationTime < end);
  const approvals = (await ctx.db.query("approvals").order("desc").take(2000)).filter((a) => a.requestedAt >= start && a.requestedAt < end);
  const agents = await ctx.db.query("agents").take(20);
  const rows: AgentPerformanceRow[] = [];
  for (const agent of agents) {
    const mine = tasks.filter((t) => t.agentSlug === agent.slug);
    const completed = mine.filter((t) => t.status === "COMPLETED");
    const durations = completed.filter((t) => t.startedAt && t.finishedAt).map((t) => (t.finishedAt! - t.startedAt!) / 60_000);
    const finished = mine.filter((t) => ["COMPLETED", "FAILED", "CANCELLED", "BUDGET_EXCEEDED"].includes(t.status));
    const app = approvals.filter((a) => a.agentSlug === agent.slug);
    const decided = app.filter((a) => ["APPROVED", "EXECUTED", "EXECUTION_FAILED", "REJECTED", "EDITED_APPROVED"].includes(a.status));
    const rejected = app.filter((a) => a.status === "REJECTED").length;
    const edited = app.filter((a) => a.status === "EDITED_APPROVED" || (a.editedPayload !== undefined && a.editedPayload !== null)).length;
    rows.push({
      agentSlug: agent.slug,
      tasks: mine.length,
      completed: completed.length,
      failed: mine.filter((t) => t.status === "FAILED" || t.status === "BUDGET_EXCEEDED").length,
      cancelled: mine.filter((t) => t.status === "CANCELLED").length,
      active: mine.filter((t) => ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS", "CANCELLING"].includes(t.status)).length,
      avgSteps: finished.length ? round(finished.reduce((s, t) => s + t.stepCount, 0) / finished.length, 1) : null,
      avgCostUsd: finished.length ? round(finished.reduce((s, t) => s + t.costUsd, 0) / finished.length, 4) : null,
      avgDurationMinutes: durations.length ? round(durations.reduce((s, d) => s + d, 0) / durations.length, 1) : null,
      unsupportedFactRatePercent: agent.slug === "executive" ? null : pct(completed.filter((t) => t.citations.length === 0).length, completed.length),
      byOrigin: mine.reduce<Record<string, number>>((acc, t) => ((acc[t.origin] = (acc[t.origin] ?? 0) + 1), acc), {}),
      approvals: { requested: app.length, approved: decided.length - rejected, rejected, edited, pending: app.filter((a) => a.status === "PENDING").length, overrideRatePercent: pct(rejected + edited, decided.length) },
    });
  }
  return { monthKey: month, rows, source: { kind: "db", retrievedAt: now } };
}

export interface CostReport {
  monthKey: string;
  totalUsd: number;
  budgetUsd: number;
  percentOfBudget: number;
  projectedUsd: number;
  projectedPercentOfBudget: number;
  daysElapsed: number;
  daysInMonth: number;
  byDay: { day: number; costUsd: number; calls: number }[];
  byOrigin: Record<string, { costUsd: number; calls: number }>;
  byModel: { model: string; costUsd: number; calls: number; inputTokens: number; outputTokens: number }[];
  byAgent: { agentSlug: string; costUsd: number; calls: number; budgetUsd: number; percentOfBudget: number }[];
  escalatedCalls: number;
  escalatedCostUsd: number;
  cacheReadSharePercent: number | null;
  webSearchRequests: number;
  source: { kind: "db"; retrievedAt: number };
}

export async function costReport(ctx: Ctx, month: string = monthKey(), now: number = Date.now()): Promise<CostReport> {
  const { start } = monthBounds(month);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const current = month === monthKey(now);
  const daysElapsed = current ? Math.max(1, Math.floor((now - start) / DAY) + 1) : daysInMonth;
  const rows = await ctx.db.query("usageLog").withIndex("by_month", (q) => q.eq("monthKey", month)).take(5000);
  const summary = await monthlyUsage(ctx, month);
  const byDay = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, costUsd: 0, calls: 0 }));
  const byOrigin: Record<string, { costUsd: number; calls: number }> = {};
  let escalatedCalls = 0;
  let escalatedCost = 0;
  let cacheRead = 0;
  let inputAll = 0;
  let webSearches = 0;
  for (const r of rows) {
    const day = Math.min(daysInMonth, Math.max(1, Math.floor((r.at - start) / DAY) + 1));
    byDay[day - 1].costUsd += r.costUsd;
    byDay[day - 1].calls += 1;
    const o = (byOrigin[r.origin] ??= { costUsd: 0, calls: 0 });
    o.costUsd += r.costUsd;
    o.calls += 1;
    if (r.escalated) {
      escalatedCalls += 1;
      escalatedCost += r.costUsd;
    }
    cacheRead += r.cacheReadTokens;
    inputAll += r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    webSearches += r.webSearchRequests ?? 0;
  }
  const projected = current ? (summary.totalUsd / daysElapsed) * daysInMonth : summary.totalUsd;
  return {
    monthKey: month,
    totalUsd: summary.totalUsd,
    budgetUsd: summary.budgetUsd,
    percentOfBudget: summary.percentOfBudget,
    projectedUsd: round(projected, 2),
    projectedPercentOfBudget: summary.budgetUsd > 0 ? round((projected / summary.budgetUsd) * 100, 1) : 0,
    daysElapsed,
    daysInMonth,
    byDay: byDay.map((d) => ({ ...d, costUsd: round(d.costUsd, 4) })),
    byOrigin: Object.fromEntries(Object.entries(byOrigin).map(([k, v]) => [k, { costUsd: round(v.costUsd, 4), calls: v.calls }])),
    byModel: summary.byModel,
    byAgent: summary.byAgent,
    escalatedCalls,
    escalatedCostUsd: round(escalatedCost, 4),
    cacheReadSharePercent: pct(cacheRead, inputAll),
    webSearchRequests: webSearches,
    source: { kind: "db", retrievedAt: now },
  };
}

export interface BookingsReport {
  total: number;
  byStatus: Record<string, number>;
  byPaymentStatus: Record<string, number>;
  byProduct: { productId: string | null; name: string; bookings: number; revenueOmr: number; pax: number }[];
  departuresByMonth: { monthKey: string; departures: number; pax: number }[];
  upcoming: { _id: string; businessId: string; customerName: string; product: string | null; status: string; travelDateFrom: number; travelDateTo: number; pax: number }[];
  avgLeadTimeDays: number | null;
  source: { kind: "db"; retrievedAt: number };
}

export async function bookingsReport(ctx: Ctx, now: number = Date.now()): Promise<BookingsReport> {
  const bookings = (await ctx.db.query("bookings").take(5000)).filter((b) => !b.archivedAt);
  const products = new Map((await ctx.db.query("products").take(2000)).map((p) => [p._id, p]));
  const count = (key: (b: Doc<"bookings">) => string) => bookings.reduce<Record<string, number>>((acc, b) => ((acc[key(b)] = (acc[key(b)] ?? 0) + 1), acc), {});
  const byProduct = new Map<string, { productId: string | null; name: string; bookings: number; revenueOmr: number; pax: number }>();
  for (const b of bookings) {
    const key = b.productId ?? "none";
    const p = byProduct.get(key) ?? { productId: b.productId ?? null, name: b.productId ? (products.get(b.productId)?.name ?? "منتج محذوف") : "بلا منتج", bookings: 0, revenueOmr: 0, pax: 0 };
    p.bookings += 1;
    p.pax += b.paxAdults + b.paxChildren;
    if (["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(b.status)) p.revenueOmr += b.totalSellingPrice.baseAmount;
    byProduct.set(key, p);
  }
  const keys = Array.from({ length: 6 }, (_, i) => monthKey(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + i, 1)));
  const departures = keys.map((k) => ({ monthKey: k, departures: 0, pax: 0 }));
  for (const b of bookings) {
    if (b.status === "CANCELLED") continue;
    const i = keys.indexOf(monthKey(b.travelDateFrom));
    if (i >= 0) {
      departures[i].departures += 1;
      departures[i].pax += b.paxAdults + b.paxChildren;
    }
  }
  const upcomingRaw = bookings.filter((b) => b.status !== "CANCELLED" && b.travelDateFrom >= now && b.travelDateFrom <= now + 30 * DAY).sort((a, b) => a.travelDateFrom - b.travelDateFrom).slice(0, 20);
  const upcoming = [];
  for (const b of upcomingRaw) {
    const customer = await ctx.db.get(b.customerId);
    upcoming.push({ _id: b._id, businessId: b.businessId, customerName: customer?.fullName ?? "—", product: b.productId ? (products.get(b.productId)?.name ?? null) : null, status: b.status, travelDateFrom: b.travelDateFrom, travelDateTo: b.travelDateTo, pax: b.paxAdults + b.paxChildren });
  }
  const leadTimes = bookings.filter((b) => b.travelDateFrom > b.createdAt).map((b) => (b.travelDateFrom - b.createdAt) / DAY);
  return {
    total: bookings.length,
    byStatus: count((b) => b.status),
    byPaymentStatus: count((b) => b.paymentStatus),
    byProduct: [...byProduct.values()].map((p) => ({ ...p, revenueOmr: round(p.revenueOmr) })).sort((a, b) => b.revenueOmr - a.revenueOmr),
    departuresByMonth: departures,
    upcoming,
    avgLeadTimeDays: leadTimes.length ? round(leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length, 1) : null,
    source: { kind: "db", retrievedAt: now },
  };
}

/** Everything the dashboard needs beyond this month's KPIs. */
export async function dashboardExtras(ctx: Ctx, now: number = Date.now()) {
  const [series, support, cost] = await Promise.all([monthlySeries(ctx, 6, now), supportReport(ctx, { days: 30 }, now), costReport(ctx, monthKey(now), now)]);
  const settings = await getSetting(ctx, "scheduledTasks");
  return {
    series: series.points,
    support: { openNow: support.openNow, avgResponseMinutes: support.avgResponseMinutes, inbound: support.inbound, escalationRatePercent: support.escalationRatePercent, autoSharePercent: support.messageApprovals.autoSharePercent },
    cost: { projectedUsd: cost.projectedUsd, projectedPercentOfBudget: cost.projectedPercentOfBudget, daysElapsed: cost.daysElapsed, daysInMonth: cost.daysInMonth },
    scheduledTasks: settings,
  };
}
