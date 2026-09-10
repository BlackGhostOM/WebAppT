"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { BarChart, LineChart } from "@/components/charts";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPercent, formatRelative, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { t, locale } = useT();
  const data = useQuery(api.dashboard.overview);

  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  const { kpis, usage, dataRisks } = data;

  return (
    <div className="space-y-6">
      <PageHeader title={t.nav.dashboard} description={`${kpis.monthKey} · ${data.emergencyStopActive ? t.chat.emergencyActive : ""}`} />

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label={t.dashboard.inquiries} value={formatNumber(kpis.inquiries)} hint={data.support.openNow.NEW + data.support.openNow.REPLY_PROPOSED + data.support.openNow.ESCALATED > 0 ? `${t.reports.openNow}: ${data.support.openNow.NEW + data.support.openNow.REPLY_PROPOSED + data.support.openNow.ESCALATED}` : undefined} />
        <Stat label={t.dashboard.newLeads} value={formatNumber(kpis.newLeads)} hint={`${t.dashboard.conversion}: ${formatPercent(kpis.conversion.wonLeadsPercent)} ${labelOf("WON", locale)}`} />
        <Stat label={t.dashboard.bookings} value={formatNumber(kpis.bookings)} hint={`${formatPercent(kpis.conversion.quoteToBookingPercent)} من العروض`} />
        <Stat label={t.dashboard.revenue} value={formatNumber(kpis.revenueOmr, 3)} />
        <Stat label={t.dashboard.agentCost} value={formatUsd(usage.totalUsd)} hint={`${formatPercent(usage.percentOfBudget)} من ${formatUsd(usage.budgetUsd)} · ${t.reports.projected} ${formatUsd(data.cost.projectedUsd)}`} />
        <Stat label={`${t.reports.responseTime} · ${t.reports.avg}`} value={data.support.avgResponseMinutes === null ? "—" : `${formatNumber(data.support.avgResponseMinutes, 0)} د`} hint={`${t.reports.escalationRate} ${formatPercent(data.support.escalationRatePercent)} · ${t.reports.days30}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{t.reports.trend} — {t.reports.months6}</CardTitle>
            <Link href="/reports" className="text-xs text-primary underline-offset-4 hover:underline">
              {t.nav.reports} ←
            </Link>
          </CardHeader>
          <CardContent>
            <BarChart
              height={150}
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
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.reports.revenueTrend}</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart height={150} points={data.series.map((p) => ({ label: p.monthKey.slice(2).replace("-", "/"), value: p.revenueOmr }))} formatValue={(n) => formatNumber(n, 0)} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">{t.dashboard.dataRisks}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t.dashboard.expiredRates} value={`${formatPercent(dataRisks.expiredCriticalRatesPercent)} (${dataRisks.expiredCriticalRates})`} warn={dataRisks.expiredCriticalRates > 0} />
            <Row label={t.dashboard.criticalGaps} value={formatNumber(dataRisks.criticalGaps)} warn={dataRisks.criticalGaps > 0} />
            <Row label={t.dashboard.conflicts} value={formatNumber(dataRisks.unresolvedConflicts)} warn={dataRisks.unresolvedConflicts > 0} />
            <Row label={t.dashboard.knowledgeGaps} value={formatNumber(dataRisks.openKnowledgeGaps)} warn={dataRisks.openKnowledgeGaps > 0} />
            <Row label={t.dashboard.unsupportedFactRate} value={formatPercent(dataRisks.unsupportedFactRatePercent)} warn={(dataRisks.unsupportedFactRatePercent ?? 0) > 20} />
            <Row label={t.dashboard.humanOverrideRate} value={formatPercent(dataRisks.humanOverrideRatePercent)} warn={(dataRisks.humanOverrideRatePercent ?? 0) > 30} />
            <Row label={t.reports.autoShare} value={formatPercent(data.support.autoSharePercent)} />
            <Link href="/settings?tab=dataHealth" className="block pt-2 text-xs text-primary underline-offset-4 hover:underline">
              {t.settings.dataHealth} ←
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.dashboard.leadsByStage}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {Object.entries(kpis.leadsByStage).length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
            {Object.entries(kpis.leadsByStage).map(([stage, count]) => (
              <div key={stage} className="flex items-center justify-between">
                <StatusBadge value={stage} />
                <span className="tabular-nums">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.dashboard.costByModel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {usage.byModel.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
            {usage.byModel.map((m) => (
              <div key={m.model} className="flex items-center justify-between">
                <span dir="ltr" className="font-mono text-xs">
                  {m.model}
                </span>
                <span className="tabular-nums">{formatUsd(m.costUsd)}</span>
              </div>
            ))}
            <div className="pt-2 text-xs font-medium text-muted-foreground">{t.dashboard.costByAgent}</div>
            {usage.byAgent.map((a) => (
              <div key={a.agentSlug} className="flex items-center justify-between">
                <AgentBadge slug={a.agentSlug} />
                <span className="tabular-nums">
                  {formatUsd(a.costUsd)} / {formatUsd(a.budgetUsd)}
                </span>
              </div>
            ))}
            {usage.overThreshold && <p className="text-xs text-destructive">⚠️ تجاوز الاستهلاك {usage.alertThresholdPercent}% من الميزانية</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t.dashboard.approvals} ({data.pendingCount})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.pendingApprovals.length === 0 && <EmptyState>{t.approvals.empty}</EmptyState>}
            {data.pendingApprovals.map((a) => (
              <Link key={a._id} href={`/approvals?id=${a._id}`} className="flex items-center justify-between gap-2 rounded-md border p-2 hover:bg-muted">
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{a.summary}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <AgentBadge slug={a.agentSlug} />
                  <StatusBadge value={a.kind} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.dashboard.activeTasks}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.activeTasks.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
            {data.activeTasks.map((task) => (
              <Link key={task._id} href={`/tasks/${task._id}`} className="flex items-center justify-between gap-2 rounded-md border p-2 hover:bg-muted">
                <div className="min-w-0">
                  <div className="truncate font-medium">{task.title}</div>
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
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${warn ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}
