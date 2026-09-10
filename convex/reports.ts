/**
 * Reports API (Phase 4). Every number is computed from the database on read;
 * definitions live in docs/KPI_DICTIONARY.md.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/actor";
import { agentPerformance, bookingsReport, costReport, monthlySeries, supportReport } from "./services/reports";

const monthArg = v.optional(v.string());

function validMonth(month: string | undefined): string | undefined {
  if (month === undefined) return undefined;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return undefined;
  return month;
}

export const series = query({
  args: { months: v.optional(v.number()) },
  handler: async (ctx, { months }) => {
    await requireUser(ctx);
    return await monthlySeries(ctx, months ?? 6);
  },
});

export const support = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    await requireUser(ctx);
    return await supportReport(ctx, { days: days ?? 30 });
  },
});

export const agents = query({
  args: { month: monthArg },
  handler: async (ctx, { month }) => {
    await requireUser(ctx);
    return await agentPerformance(ctx, validMonth(month));
  },
});

export const cost = query({
  args: { month: monthArg },
  handler: async (ctx, { month }) => {
    await requireUser(ctx);
    return await costReport(ctx, validMonth(month));
  },
});

export const bookings = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await bookingsReport(ctx);
  },
});
