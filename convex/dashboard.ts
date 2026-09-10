/**
 * Owner dashboard: KPIs computed from data, running tasks, approval inbox,
 * budget and the "data risks that need your attention" card (section 4.10).
 */
import { query } from "./_generated/server";
import { computeKpis } from "./agents/tools";
import { requireUser } from "./lib/actor";
import { computeFreshness } from "./lib/freshness";
import { monthKey } from "./lib/settings";
import { listPending } from "./services/approvals";
import { listActiveTasks } from "./services/tasks";
import { monthlyUsage } from "./services/usage";

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const kpis = await computeKpis(ctx);
    const usage = await monthlyUsage(ctx);
    const activeTasks = await listActiveTasks(ctx);
    const pendingApprovals = await listPending(ctx, 10);
    const pendingCount = (await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "PENDING")).take(500)).length;

    // --- Data risk card -----------------------------------------------------
    const rates = (await ctx.db.query("rates").take(2000)).filter((r) => !r.archivedAt && r.status !== "ARCHIVED" && r.status !== "SUPERSEDED");
    const critical = rates.filter((r) => r.rateTrust === "CONTRACTED" || r.rateTrust === "SUPPLIER_CONFIRMED");
    const expiredCritical = critical.filter((r) => computeFreshness(r) === "EXPIRED").length;
    const openGaps = (await ctx.db.query("dataGaps").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(200)).filter((g) => g.severity === "D3" || g.severity === "D4").length;
    const unresolvedConflicts = (await ctx.db.query("dataConflicts").withIndex("by_status", (q) => q.eq("status", "ESCALATED")).take(200)).length;
    const openKnowledgeGaps = (await ctx.db.query("knowledgeGaps").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(200)).length;

    const month = monthKey();
    const [y, m] = month.split("-").map(Number);
    const start = Date.UTC(y, m - 1, 1);
    const completed = (await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "COMPLETED")).take(1000)).filter((t) => (t.finishedAt ?? 0) >= start);
    const unsupported = completed.filter((t) => t.citations.length === 0 && t.agentSlug !== "executive").length;
    const decided = (await ctx.db.query("approvals").take(2000)).filter((a) => a.decidedAt && a.decidedAt >= start && ["APPROVED", "REJECTED", "EDITED_APPROVED", "EXECUTED", "EXECUTION_FAILED"].includes(a.status));
    const overridden = decided.filter((a) => a.status === "REJECTED" || a.status === "EDITED_APPROVED" || (a.editedPayload !== undefined && a.editedPayload !== null)).length;
    const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);

    const notifications = await ctx.db.query("notifications").withIndex("by_unread", (q) => q.eq("readAt", undefined)).order("desc").take(10);
    const emergency = (await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "emergencyStop")).unique())?.value as { active?: boolean } | undefined;

    return {
      kpis,
      usage,
      activeTasks: activeTasks.sort((a, b) => b._creationTime - a._creationTime).slice(0, 12),
      pendingApprovals,
      pendingCount,
      dataRisks: {
        expiredCriticalRatesPercent: pct(expiredCritical, critical.length),
        expiredCriticalRates: expiredCritical,
        criticalGaps: openGaps,
        unresolvedConflicts,
        openKnowledgeGaps,
        unsupportedFactRatePercent: pct(unsupported, completed.length),
        humanOverrideRatePercent: pct(overridden, decided.length),
      },
      notifications,
      emergencyStopActive: emergency?.active ?? false,
    };
  },
});
