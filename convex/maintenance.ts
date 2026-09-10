/**
 * Scheduled maintenance (section 4.10): freshness engine, expiry alerts at 30
 * and 7 days, decision/memory expiry, data-gap detection and a task watchdog.
 */
import { internalMutation } from "./_generated/server";
import { computeFreshness, isAlertDay } from "./lib/freshness";
import { upsertDataGap } from "./services/governance";
import { appendAudit } from "./lib/audit";

export const recomputeFreshness = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let updated = 0;
    const alerts: string[] = [];
    const tables = ["rates", "products", "pricingRules", "policies", "documents", "contracts"] as const;
    for (const table of tables) {
      const rows = await ctx.db.query(table).take(5000);
      for (const row of rows) {
        if (row.archivedAt) continue;
        const fresh = computeFreshness(row, now);
        if (fresh !== row.freshness) {
          await ctx.db.patch(row._id, { freshness: fresh });
          updated += 1;
        }
        const day = isAlertDay(row.validTo, now);
        if (day && (table === "rates" || table === "contracts" || table === "products")) {
          const named = row as { name?: string; title?: string; serviceDescription?: string; businessId: string };
          const label = named.name ?? named.title ?? named.serviceDescription ?? named.businessId;
          alerts.push(`${row.businessId}:${day}`);
          await ctx.db.insert("notifications", {
            kind: "EXPIRY_ALERT",
            title: `ينتهي خلال ${day} يوماً: ${label}`,
            body: `السجل ${row.businessId} في جدول ${table} ينتهي في ${new Date(row.validTo!).toISOString().slice(0, 10)}.`,
            severity: day === 7 ? "WARNING" : "INFO",
            relatedTable: table,
            relatedRecordId: row._id,
            createdAt: now,
          });
        }
      }
    }
    // Expire decisions and memories whose validity ended.
    for (const d of await ctx.db.query("decisionRegister").withIndex("by_status", (q) => q.eq("status", "ACTIVE")).take(1000)) {
      if (d.effectiveTo !== undefined && d.effectiveTo < now) await ctx.db.patch(d._id, { status: "EXPIRED", updatedAt: now });
    }
    for (const m of await ctx.db.query("memories").withIndex("by_status", (q) => q.eq("status", "APPROVED")).take(2000)) {
      if (m.expiresAt !== undefined && m.expiresAt < now) await ctx.db.patch(m._id, { status: "EXPIRED" });
    }
    for (const doc of await ctx.db.query("documents").withIndex("by_lifecycle", (q) => q.eq("lifecycle", "ACTIVE")).take(1000)) {
      if (doc.reviewDueAt !== undefined && doc.reviewDueAt < now) {
        await ctx.db.patch(doc._id, { lifecycle: "REVIEW_DUE", updatedAt: now });
        for (const c of await ctx.db.query("knowledgeChunks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(2000)) await ctx.db.patch(c._id, { lifecycle: "REVIEW_DUE" });
      }
    }
    // Data gaps (section 4.7): critical fields missing across a large share of records.
    const hotels = (await ctx.db.query("hotels").take(2000)).filter((h) => !h.archivedAt);
    await upsertDataGap(ctx, { table: "hotels", field: "childPolicy", description: "فنادق بلا سياسة أطفال", affectedCount: hotels.filter((h) => !h.childPolicy).length, totalCount: hotels.length, severity: "D2" });
    const rates = (await ctx.db.query("rates").take(5000)).filter((r) => !r.archivedAt && r.status === "ACTIVE");
    await upsertDataGap(ctx, { table: "rates", field: "validTo", description: "أسعار فعّالة منتهية الصلاحية", affectedCount: rates.filter((r) => computeFreshness(r, now) === "EXPIRED").length, totalCount: rates.length, severity: "D3" });
    await upsertDataGap(ctx, { table: "rates", field: "cancellationTerms", description: "أسعار بلا شروط إلغاء موثقة", affectedCount: rates.filter((r) => !r.cancellationTerms || r.cancellationTerms === "REQUIRES_VERIFICATION").length, totalCount: rates.length, severity: "D3" });
    const suppliers = (await ctx.db.query("suppliers").take(2000)).filter((s) => !s.archivedAt);
    await upsertDataGap(ctx, { table: "suppliers", field: "phone", description: "موردون بلا بيانات اتصال", affectedCount: suppliers.filter((s) => !s.phone && !s.email).length, totalCount: suppliers.length, severity: "D2" });
    const customers = (await ctx.db.query("customers").take(5000)).filter((c) => !c.archivedAt);
    await upsertDataGap(ctx, { table: "customers", field: "consentStatus", description: "عملاء بلا موافقة تواصل صريحة", affectedCount: customers.filter((c) => c.consentStatus === "PENDING" || c.consentStatus === "NOT_GRANTED").length, totalCount: customers.length, severity: "D3" });

    await appendAudit(ctx, { actor: { type: "system", id: "cron:recomputeFreshness" }, table: "settings", recordId: "freshness", event: "SYSTEM", newValue: { updated, alerts: alerts.length }, severity: "D1" });
    return { updated, alerts: alerts.length };
  },
});

/** Marks tasks that have been RUNNING with no progress for too long as FAILED. */
export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuckAfter = 45 * 60 * 1000;
    let failed = 0;
    for (const status of ["RUNNING", "CANCELLING"] as const) {
      const rows = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", status)).take(500);
      for (const task of rows) {
        const runs = await ctx.db.query("taskRuns").withIndex("by_task", (q) => q.eq("taskId", task._id)).order("desc").take(1);
        const last = runs[0]?.createdAt ?? task.startedAt ?? task._creationTime;
        if (now - last < stuckAfter) continue;
        await ctx.db.patch(task._id, { status: status === "CANCELLING" ? "CANCELLED" : "FAILED", error: status === "CANCELLING" ? undefined : "WATCHDOG: لا تقدم منذ 45 دقيقة", finishedAt: now });
        await ctx.db.insert("taskRuns", { taskId: task._id, stepIndex: task.stepCount + 1, kind: status === "CANCELLING" ? "CANCELLED" : "ERROR", note: "watchdog", createdAt: now });
        await ctx.db.patch(task._id, { stepCount: task.stepCount + 1 });
        failed += 1;
      }
    }
    return { failed };
  },
});
