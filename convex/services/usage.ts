/**
 * Token/cost accounting and budget guard (sections 2.1 and 5).
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { computeCostUsd } from "../lib/llm/pricing";
import type { LlmUsage } from "../lib/llm/types";
import { getSetting, monthKey } from "../lib/settings";
import type { AgentSlug, LlmProvider, RequestOrigin } from "../lib/vocab";

export interface LogUsageInput {
  taskId?: Id<"tasks">;
  agentSlug: AgentSlug;
  model: string;
  provider: LlmProvider;
  origin: RequestOrigin;
  usage: LlmUsage;
  batch?: boolean;
  escalated?: boolean;
  escalationReason?: string;
}

export async function logUsage(ctx: MutationCtx, input: LogUsageInput): Promise<number> {
  const costUsd = computeCostUsd(input.model, input.usage, input.batch ?? false);
  const now = Date.now();
  await ctx.db.insert("usageLog", {
    taskId: input.taskId,
    agentSlug: input.agentSlug,
    model: input.model,
    provider: input.provider,
    origin: input.origin,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    cacheWriteTokens: input.usage.cacheWriteTokens,
    webSearchRequests: input.usage.webSearchRequests ?? 0,
    costUsd,
    batch: input.batch ?? false,
    escalated: input.escalated ?? false,
    escalationReason: input.escalationReason,
    monthKey: monthKey(now),
    at: now,
  });
  return costUsd;
}

export interface MonthlyUsageSummary {
  monthKey: string;
  totalUsd: number;
  budgetUsd: number;
  percentOfBudget: number;
  alertThresholdPercent: number;
  overThreshold: boolean;
  byModel: { model: string; costUsd: number; calls: number; inputTokens: number; outputTokens: number }[];
  byAgent: { agentSlug: AgentSlug; costUsd: number; calls: number; budgetUsd: number; percentOfBudget: number }[];
}

export async function monthlyUsage(ctx: QueryCtx | MutationCtx, month: string = monthKey()): Promise<MonthlyUsageSummary> {
  const rows = await ctx.db.query("usageLog").withIndex("by_month", (q) => q.eq("monthKey", month)).take(5000);
  const budget = await getSetting(ctx, "budget");
  const agents = await ctx.db.query("agents").take(20);
  const byModel = new Map<string, { model: string; costUsd: number; calls: number; inputTokens: number; outputTokens: number }>();
  const byAgent = new Map<string, { agentSlug: AgentSlug; costUsd: number; calls: number }>();
  let total = 0;
  for (const r of rows) {
    total += r.costUsd;
    const m = byModel.get(r.model) ?? { model: r.model, costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
    m.costUsd += r.costUsd;
    m.calls += 1;
    m.inputTokens += r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    m.outputTokens += r.outputTokens;
    byModel.set(r.model, m);
    const a = byAgent.get(r.agentSlug) ?? { agentSlug: r.agentSlug, costUsd: 0, calls: 0 };
    a.costUsd += r.costUsd;
    a.calls += 1;
    byAgent.set(r.agentSlug, a);
  }
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const percent = budget.monthlyBudgetUsd > 0 ? Math.round((total / budget.monthlyBudgetUsd) * 1000) / 10 : 0;
  return {
    monthKey: month,
    totalUsd: round(total),
    budgetUsd: budget.monthlyBudgetUsd,
    percentOfBudget: percent,
    alertThresholdPercent: budget.alertThresholdPercent,
    overThreshold: percent >= budget.alertThresholdPercent,
    byModel: [...byModel.values()].map((m) => ({ ...m, costUsd: round(m.costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
    byAgent: agents.map((agent) => {
      const a = byAgent.get(agent.slug) ?? { agentSlug: agent.slug, costUsd: 0, calls: 0 };
      return {
        ...a,
        costUsd: round(a.costUsd),
        budgetUsd: agent.monthlyBudgetUsd,
        percentOfBudget: agent.monthlyBudgetUsd > 0 ? Math.round((a.costUsd / agent.monthlyBudgetUsd) * 1000) / 10 : 0,
      };
    }),
  };
}

/** Sum of an agent's spend this month (used before every model call). */
export async function agentMonthSpend(ctx: QueryCtx | MutationCtx, agentSlug: AgentSlug, month: string = monthKey()): Promise<number> {
  const rows = await ctx.db.query("usageLog").withIndex("by_month_agent", (q) => q.eq("monthKey", month).eq("agentSlug", agentSlug)).take(5000);
  return rows.reduce((s, r) => s + r.costUsd, 0);
}

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
  agentSpendUsd: number;
  agentBudgetUsd: number;
  companySpendUsd: number;
  companyBudgetUsd: number;
}

export async function checkBudget(ctx: QueryCtx | MutationCtx, agentSlug: AgentSlug): Promise<BudgetCheck> {
  const agent = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", agentSlug)).unique();
  const summary = await monthlyUsage(ctx);
  const agentSpend = summary.byAgent.find((a) => a.agentSlug === agentSlug)?.costUsd ?? 0;
  const agentBudget = agent?.monthlyBudgetUsd ?? 0;
  const result: BudgetCheck = {
    allowed: true,
    agentSpendUsd: agentSpend,
    agentBudgetUsd: agentBudget,
    companySpendUsd: summary.totalUsd,
    companyBudgetUsd: summary.budgetUsd,
  };
  if (agentBudget > 0 && agentSpend >= agentBudget) return { ...result, allowed: false, reason: `تجاوز الوكيل ${agentSlug} حده الشهري (${agentBudget}$)` };
  if (summary.budgetUsd > 0 && summary.totalUsd >= summary.budgetUsd) return { ...result, allowed: false, reason: `تجاوزت الشركة الميزانية الشهرية (${summary.budgetUsd}$)` };
  return result;
}

/** Creates a single WARNING notification when the 80% threshold is crossed this month. */
export async function maybeNotifyBudgetThreshold(ctx: MutationCtx) {
  const summary = await monthlyUsage(ctx);
  if (!summary.overThreshold) return;
  const existing = await ctx.db.query("notifications").withIndex("by_unread", (q) => q.eq("readAt", undefined)).take(200);
  const already = existing.some((n) => n.kind === "BUDGET_THRESHOLD" && n.relatedRecordId === summary.monthKey);
  if (already) return;
  await ctx.db.insert("notifications", {
    kind: "BUDGET_THRESHOLD",
    title: "تنبيه ميزانية الذكاء الاصطناعي",
    body: `بلغ استهلاك هذا الشهر ${summary.percentOfBudget}% من الميزانية (${summary.totalUsd}$ من ${summary.budgetUsd}$).`,
    severity: "WARNING",
    relatedTable: "usageLog",
    relatedRecordId: summary.monthKey,
    createdAt: Date.now(),
  });
}
