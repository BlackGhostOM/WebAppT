/**
 * Technical data-health view (Settings) and governance lists: gaps, conflicts,
 * knowledge gaps, memory proposals.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { computeFreshness } from "./lib/freshness";
import { resolveConflictByOwner, reviewMemory } from "./services/governance";

export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rules = (await ctx.db.query("dataQualityRules").take(100)).filter((r) => r.enabled);
    const tables = {
      customers: (await ctx.db.query("customers").take(2000)).filter((r) => !r.archivedAt),
      suppliers: (await ctx.db.query("suppliers").take(2000)).filter((r) => !r.archivedAt),
      hotels: (await ctx.db.query("hotels").take(2000)).filter((r) => !r.archivedAt),
      rates: (await ctx.db.query("rates").take(2000)).filter((r) => !r.archivedAt),
      products: (await ctx.db.query("products").take(2000)).filter((r) => !r.archivedAt),
      destinations: (await ctx.db.query("destinations").take(2000)).filter((r) => !r.archivedAt),
    } as Record<string, Record<string, unknown>[]>;
    const getPath = (obj: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);

    const missingFields = rules
      .filter((r) => r.table !== "*" && r.field && tables[r.table])
      .map((r) => {
        const rows = tables[r.table];
        const missing = rows.filter((row) => {
          const v = getPath(row, r.field!);
          if (r.name === "customer_contact") return !row.phone && !row.email;
          if (r.name === "rate_validity") return v === undefined || (typeof v === "number" && v < Date.now());
          return v === undefined || v === null || v === "" || (typeof v === "string" && ["UNKNOWN", "NOT_PROVIDED", "REQUIRES_VERIFICATION"].includes(v));
        }).length;
        return { rule: r.name, table: r.table, field: r.field, description: r.description, missing, total: rows.length, percent: rows.length ? Math.round((missing / rows.length) * 1000) / 10 : 0, severity: r.severity };
      });

    const stale = Object.entries(tables)
      .filter(([, rows]) => rows.some((r) => "freshness" in r))
      .map(([table, rows]) => {
        const computed = rows.map((r) => computeFreshness(r as never));
        return { table, expired: computed.filter((f) => f === "EXPIRED").length, expiring: computed.filter((f) => f === "EXPIRING").length, requiresVerification: computed.filter((f) => f === "REQUIRES_VERIFICATION").length, total: rows.length };
      });

    const unverified = Object.entries(tables).map(([table, rows]) => ({ table, migratedUnverified: rows.filter((r) => r.verificationStatus === "MIGRATED_UNVERIFIED").length, aiExtracted: rows.filter((r) => r.verificationStatus === "AI_EXTRACTED").length, total: rows.length }));

    const dupGroups = (rows: Record<string, unknown>[], key: string) => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const k = r[key];
        if (typeof k === "string" && k) map.set(k, (map.get(k) ?? 0) + 1);
      }
      return [...map.values()].filter((n) => n > 1).length;
    };
    const duplicates = [
      { table: "customers", key: "normalizedPhone", groups: dupGroups(tables.customers, "normalizedPhone") },
      { table: "customers", key: "normalizedEmail", groups: dupGroups(tables.customers, "normalizedEmail") },
      { table: "suppliers", key: "normalizedName", groups: dupGroups(tables.suppliers, "normalizedName") },
      { table: "hotels", key: "normalizedName", groups: dupGroups(tables.hotels, "normalizedName") },
    ];

    const failedExecutions = (await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "EXECUTION_FAILED")).take(100)).length;
    const failedExtractions = (await ctx.db.query("documents").take(500)).filter((d) => d.extractionStatus === "FAILED").length;
    const failedTasks = (await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "FAILED")).take(200)).length;

    return { missingFields, stale, unverified, duplicates, integrationFailures: { failedExecutions, failedExtractions, failedTasks } };
  },
});

export const gaps = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const data = await ctx.db.query("dataGaps").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(100);
    const knowledge = await ctx.db.query("knowledgeGaps").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(100);
    return { data, knowledge };
  },
});

/** Tables a conflict may point at, with the owner page that shows the record. */
const CONFLICT_TABLES = ["products", "customers", "suppliers", "hotels", "destinations", "attractions", "experiences", "rates", "bookings", "leads", "pricingRules", "policies", "decisionRegister", "quotes", "documents"] as const;
type ConflictTable = (typeof CONFLICT_TABLES)[number];
const WITH_BUSINESS_ID: readonly ConflictTable[] = ["products", "customers", "suppliers", "hotels", "destinations", "rates", "bookings", "leads", "quotes", "documents"];

/** Finds the record behind a conflict whether the agent stored a Convex id or a business id, and builds its link. */
async function describeRecord(ctx: QueryCtx, table: string, recordId: string | undefined): Promise<{ href?: string; label: string; found: boolean }> {
  if (!recordId) return { label: table, found: false };
  if (!(CONFLICT_TABLES as readonly string[]).includes(table)) return { label: `${table} · ${recordId}`, found: false };
  const t = table as ConflictTable;
  let doc: Record<string, unknown> | null = null;
  const normalized = ctx.db.normalizeId(t, recordId);
  if (normalized) doc = (await ctx.db.get(normalized)) as Record<string, unknown> | null;
  if (!doc && WITH_BUSINESS_ID.includes(t)) {
    doc = (await ctx.db
      .query(t as "products")
      .withIndex("by_businessId", (q) => q.eq("businessId", recordId))
      .unique()) as Record<string, unknown> | null;
  }
  if (!doc) return { label: `${table} · ${recordId}`, found: false };
  const id = String(doc._id);
  const label = String(doc.name ?? doc.fullName ?? doc.title ?? doc.contactName ?? doc.serviceDescription ?? doc.businessId ?? recordId);
  const href = t === "products" ? `/products/${id}` : `/data/${t}?id=${id}`;
  return { href, label: doc.businessId ? `${label} (${String(doc.businessId)})` : label, found: true };
}

async function enrichConflict(ctx: QueryCtx, c: Doc<"dataConflicts">) {
  const record = await describeRecord(ctx, c.table, c.recordId);
  const task = c.taskId ? await ctx.db.get(c.taskId) : null;
  return { ...c, record, task: task ? { _id: task._id, businessId: task.businessId, title: task.title, agentSlug: task.agentSlug } : null };
}

export const conflicts = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const escalated = await ctx.db.query("dataConflicts").withIndex("by_status", (q) => q.eq("status", "ESCALATED")).order("desc").take(100);
    const resolved = await ctx.db.query("dataConflicts").withIndex("by_status", (q) => q.eq("status", "RESOLVED")).order("desc").take(30);
    return { escalated: await Promise.all(escalated.map((c) => enrichConflict(ctx, c))), resolved: await Promise.all(resolved.map((c) => enrichConflict(ctx, c))) };
  },
});

export const resolveConflict = mutation({
  args: { conflictId: v.id("dataConflicts"), value: v.any(), reason: v.string() },
  handler: async (ctx, { conflictId, value, reason }) => {
    const user = await requireOwner(ctx);
    await resolveConflictByOwner(ctx, ownerActor(user), conflictId, value, reason);
    return null;
  },
});

export const dismissGap = mutation({
  args: { kind: v.union(v.literal("data"), v.literal("knowledge")), id: v.string() },
  handler: async (ctx, { kind, id }) => {
    await requireOwner(ctx);
    if (kind === "data") {
      const gapId = ctx.db.normalizeId("dataGaps", id);
      if (gapId) await ctx.db.patch(gapId, { status: "DISMISSED", updatedAt: Date.now() });
    } else {
      const gapId = ctx.db.normalizeId("knowledgeGaps", id);
      if (gapId) await ctx.db.patch(gapId, { status: "DISMISSED" });
    }
    return null;
  },
});

export const memoryProposals = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("memories").withIndex("by_status", (q) => q.eq("status", "PROPOSED")).order("desc").take(100);
  },
});

export const decideMemory = mutation({
  args: { memoryId: v.id("memories"), decision: v.union(v.literal("APPROVED"), v.literal("REJECTED")), reason: v.optional(v.string()) },
  handler: async (ctx, { memoryId, decision, reason }) => {
    const user = await requireOwner(ctx);
    await reviewMemory(ctx, ownerActor(user), memoryId, decision, reason);
    return null;
  },
});
