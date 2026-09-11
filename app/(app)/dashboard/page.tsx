"use client";

import { useQuery } from "convex/react";
import { AlertTriangleIcon, CheckCircle2Icon, CheckSquareIcon, DatabaseIcon, InboxIcon, ListChecksIcon } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { BarChart, LineChart } from "@/components/charts";
import { EmptyState, MoreLink, PageHeader, Section } from "@/components/page-header";
import { StatCard, StatCardSkeleton } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPercent, formatRelative, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Reading order = decision order: what needs the owner right now, then this
 * month's numbers, then trends, then what the agents are doing.
 */
export default function DashboardPage() {
  const { t, locale } = useT();
  const data = useQuery(api.dashboard.overview);

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t.nav.dashboard} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56 rounded-xl lg:col-span-2" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  const { kpis, usage, dataRisks, support } = data;
  const openMessages = support.openNow.NEW + support.openNow.REPLY_PROPOSED + support.openNow.ESCALATED;
  const riskCount = dataRisks.expiredCriticalRates + dataRisks.criticalGaps + dataRisks.unresolvedConflicts;
  const queues = [
    { key: "approvals", label: t.dashboard.approvals, count: data.pendingCount, href: "/approvals", icon: <CheckSquareIcon /> },
    { key: "messages", label: t.dashboard.openMessages, count: openMessages, href: "/inbox", icon: <InboxIcon /> },
    { key: "risks", label: t.dashboard.dataRisksShort, count: riskCount, href: "/settings?tab=dataHealth", icon: <DatabaseIcon /> },
    { key: "gaps", label: t.dashboard.knowledgeGaps, count: dataRisks.openKnowledgeGaps, href: "/settings?tab=governance#gaps", icon: <AlertTriangleIcon /> },
  ];
  const anythingPending = queues.some((q) => q.count > 0);

  return (
    <div className="space-y-8">
      <PageHeader title={t.nav.dashboard} description={t.dashboard.description} />

      {/* 1 — What needs the owner */}
      <Section title={t.dashboard.needsYou} action={data.pendingCount > 0 ? <Button nativeButton={false} render={<Link href="/approvals" />}>{t.dashboard.openApprovals}</Button> : undefined}>
        {!anythingPending ? (
          <EmptyState icon={<CheckCircle2Icon className="text-success" />} title={t.dashboard.allClear} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {queues.map((q) => (
              <StatCard key={q.key} label={q.label} value={formatNumber(q.count)} tone={q.count > 0 ? "warn" : "default"} href={q.href} icon={q.icon} hint={q.count > 0 ? t.common.open : undefined} />
            ))}
          </div>
        )}
        {data.pendingApprovals.length > 0 && (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {data.pendingApprovals.slice(0, 5).map((a) => (
                <li key={a._id}>
                  <Link href={`/approvals?id=${a._id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{a.summary}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <AgentBadge slug={a.agentSlug} />
                      <StatusBadge value={a.kind} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {data.pendingCount > 5 && (
              <div className="border-t px-4 py-2 text-end">
                <MoreLink href="/approvals">{t.common.viewAll} ({formatNumber(data.pendingCount)})</MoreLink>
              </div>
            )}
          </Card>
        )}
      </Section>

      {/* 2 — This month */}
      <Section title={kpis.monthKey} description={t.reports.description}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label={t.dashboard.inquiries} value={formatNumber(kpis.inquiries)} hint={openMessages > 0 ? `${t.reports.openNow}: ${formatNumber(openMessages)}` : undefined} />
          <StatCard label={t.dashboard.newLeads} value={formatNumber(kpis.newLeads)} hint={`${t.dashboard.conversion}: ${formatPercent(kpis.conversion.wonLeadsPercent)} ${labelOf("WON", locale)}`} />
          <StatCard label={t.dashboard.bookings} value={formatNumber(kpis.bookings)} hint={`${formatPercent(kpis.conversion.quoteToBookingPercent)} ${t.dashboard.fromQuotes}`} />
          <StatCard label={t.dashboard.revenue} value={formatNumber(kpis.revenueOmr, 3)} tone="primary" />
          <StatCard label={t.dashboard.agentCost} value={formatUsd(usage.totalUsd)} tone={usage.overThreshold ? "warn" : "default"} hint={`${formatPercent(usage.percentOfBudget)} ${t.dashboard.ofBudget} ${formatUsd(usage.budgetUsd)} · ${t.reports.projected} ${formatUsd(data.cost.projectedUsd)}`} href="/reports" />
          <StatCard label={`${t.reports.responseTime} · ${t.reports.avg}`} value={support.avgResponseMinutes === null ? "—" : `${formatNumber(support.avgResponseMinutes, 0)} ${t.dashboard.minutesShort}`} hint={`${t.reports.escalationRate} ${formatPercent(support.escalationRatePercent)} · ${t.reports.days30}`} />
        </div>
        {usage.overThreshold && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text">
            <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
            {t.dashboard.overBudgetAlert.replace("{percent}", String(usage.alertThresholdPercent))}
          </p>
        )}
      </Section>

      {/* 3 — Trends */}
      <Section title={t.dashboard.trends} action={<MoreLink href="/reports">{t.nav.reports}</MoreLink>}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                {t.reports.trend} — {t.reports.months6}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart
                height={160}
                data={data.series.map((p) => ({ label: p.monthKey.slice(2).replace("-", "/"), values: { inquiries: p.inquiries, newLeads: p.newLeads, bookings: p.bookings } }))}
                series={[
                  { key: "inquiries", name: t.reports.inquiries },
                  { key: "newLeads", name: t.reports.leads },
                  { key: "bookings", name: t.reports.bookings },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t.reports.revenueTrend}</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart height={160} points={data.series.map((p) => ({ label: p.monthKey.slice(2).replace("-", "/"), value: p.revenueOmr }))} formatValue={(n) => formatNumber(n, 0)} />
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* 4 — Operations */}
      <Section title={t.dashboard.operations}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t.dashboard.activeTasks}</CardTitle>
              <MoreLink href="/tasks">{t.common.viewAll}</MoreLink>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.activeTasks.length === 0 && <EmptyState icon={<ListChecksIcon />}>{t.common.empty}</EmptyState>}
              {data.activeTasks.slice(0, 6).map((task) => (
                <Link key={task._id} href={`/tasks/${task._id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:bg-accent/50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{task.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {task.businessId} · {formatRelative(task._creationTime, locale)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <AgentBadge slug={task.agentSlug} />
                    <StatusBadge value={task.status} />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t.dashboard.leadsByStage}</CardTitle>
              <MoreLink href="/pipeline">{t.nav.pipeline}</MoreLink>
            </CardHeader>
            <CardContent>
              {Object.entries(kpis.leadsByStage).length === 0 ? (
                <EmptyState>{t.common.empty}</EmptyState>
              ) : (
                <ul className="divide-y">
                  {Object.entries(kpis.leadsByStage).map(([stage, count]) => (
                    <li key={stage} className="flex items-center justify-between py-2">
                      <StatusBadge value={stage} />
                      <span className="text-sm font-medium tabular-nums">{formatNumber(count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.dashboard.dataRisks}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                <RiskRow label={t.dashboard.expiredRates} value={`${formatPercent(dataRisks.expiredCriticalRatesPercent)} (${formatNumber(dataRisks.expiredCriticalRates)})`} warn={dataRisks.expiredCriticalRates > 0} />
                <RiskRow label={t.dashboard.criticalGaps} value={formatNumber(dataRisks.criticalGaps)} warn={dataRisks.criticalGaps > 0} />
                <RiskRow label={t.dashboard.conflicts} value={formatNumber(dataRisks.unresolvedConflicts)} warn={dataRisks.unresolvedConflicts > 0} />
                <RiskRow label={t.dashboard.knowledgeGaps} value={formatNumber(dataRisks.openKnowledgeGaps)} warn={dataRisks.openKnowledgeGaps > 0} />
                <RiskRow label={t.dashboard.unsupportedFactRate} value={formatPercent(dataRisks.unsupportedFactRatePercent)} warn={(dataRisks.unsupportedFactRatePercent ?? 0) > 20} />
                <RiskRow label={t.dashboard.humanOverrideRate} value={formatPercent(dataRisks.humanOverrideRatePercent)} warn={(dataRisks.humanOverrideRatePercent ?? 0) > 30} />
                <RiskRow label={t.reports.autoShare} value={formatPercent(support.autoSharePercent)} />
              </ul>
              <div className="pt-3">
                <MoreLink href="/settings?tab=dataHealth">{t.settings.dataHealth}</MoreLink>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.costByAgent}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <ul className="divide-y">
              {usage.byAgent.map((a) => (
                <li key={a.agentSlug} className="flex items-center justify-between py-2 text-sm">
                  <AgentBadge slug={a.agentSlug} />
                  <span className="tabular-nums">
                    {formatUsd(a.costUsd)} <span className="text-muted-foreground">/ {formatUsd(a.budgetUsd)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{t.dashboard.costByModel}</div>
              {usage.byModel.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
              <ul className="divide-y">
                {usage.byModel.map((m) => (
                  <li key={m.model} className="flex items-center justify-between py-2 text-sm">
                    <span dir="ltr" className="font-mono text-xs">
                      {m.model}
                    </span>
                    <span className="tabular-nums">{formatUsd(m.costUsd)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

function RiskRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", warn && "text-warning-text")}>{value}</span>
    </li>
  );
}
