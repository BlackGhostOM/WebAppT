"use client";

import { useQuery } from "convex/react";
import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { BarChart, BreakdownBars, downloadCsv, LineChart } from "@/components/charts";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber, formatPercent, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

const TABS = ["overview", "support", "agents", "cost", "bookings"] as const;

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return <StatCard label={label} value={value} hint={hint} tone={warn ? "warn" : "default"} />;
}

function Section({ title, children, onExport }: { title: string; children: React.ReactNode; onExport?: () => void }) {
  const { t } = useT();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle>{title}</CardTitle>
        {onExport && (
          <Button size="xs" variant="outline" onClick={onExport}>
            <DownloadIcon data-icon="inline-start" /> {t.reports.exportCsv}
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const shortMonth = (key: string) => key.slice(2).replace("-", "/");
const toEntries = (rec: Record<string, number> | undefined, locale: "ar" | "en") =>
  Object.entries(rec ?? {})
    .map(([k, v]) => ({ label: labelOf(k, locale), value: v }))
    .sort((a, b) => b.value - a.value);

export default function ReportsPage() {
  const { t, locale } = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.reports}
        description={t.reports.description}
        actions={
          <Link href="/settings?tab=scheduled" className="text-xs text-primary-text underline-offset-4 hover:underline">
            {t.settings.scheduled} ←
          </Link>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">{t.reports.overview}</TabsTrigger>
          <TabsTrigger value="support">{t.reports.supportTab}</TabsTrigger>
          <TabsTrigger value="agents">{t.reports.agentsTab}</TabsTrigger>
          <TabsTrigger value="cost">{t.reports.costTab}</TabsTrigger>
          <TabsTrigger value="bookings">{t.reports.bookingsTab}</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "overview" && <OverviewTab locale={locale} />}
      {tab === "support" && <SupportTab locale={locale} />}
      {tab === "agents" && <AgentsTab locale={locale} />}
      {tab === "cost" && <CostTab />}
      {tab === "bookings" && <BookingsTab locale={locale} />}
    </div>
  );
}

function OverviewTab({ locale }: { locale: "ar" | "en" }) {
  const { t } = useT();
  const data = useQuery(api.reports.series, { months: 6 });
  if (!data) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  const points = data.points;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const delta = (a: number, b: number | undefined) =>
    b === undefined || b === 0 ? "" : `${a >= b ? "▲" : "▼"} ${formatPercent(Math.abs(((a - b) / b) * 100))}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label={t.reports.inquiries} value={formatNumber(last?.inquiries)} hint={delta(last?.inquiries ?? 0, prev?.inquiries)} />
        <Stat label={t.reports.leads} value={formatNumber(last?.newLeads)} hint={delta(last?.newLeads ?? 0, prev?.newLeads)} />
        <Stat label={t.reports.quotes} value={formatNumber(last?.quotes)} hint={delta(last?.quotes ?? 0, prev?.quotes)} />
        <Stat label={t.reports.bookings} value={formatNumber(last?.bookings)} hint={delta(last?.bookings ?? 0, prev?.bookings)} />
        <Stat label={t.dashboard.revenue} value={formatNumber(last?.revenueOmr, 3)} hint={delta(last?.revenueOmr ?? 0, prev?.revenueOmr)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`${t.reports.trend} — ${t.reports.months6}`} onExport={() => downloadCsv("monthly-series.csv", points)}>
          <BarChart
            data={points.map((p) => ({
              label: shortMonth(p.monthKey),
              values: { inquiries: p.inquiries, newLeads: p.newLeads, quotes: p.quotes, bookings: p.bookings, wonLeads: p.wonLeads },
            }))}
            series={[
              { key: "inquiries", name: t.reports.inquiries },
              { key: "newLeads", name: t.reports.leads },
              { key: "quotes", name: t.reports.quotes },
              { key: "bookings", name: t.reports.bookings },
              { key: "wonLeads", name: t.reports.won },
            ]}
          />
        </Section>
        <Section title={t.reports.revenueTrend}>
          <LineChart points={points.map((p) => ({ label: shortMonth(p.monthKey), value: p.revenueOmr }))} formatValue={(n) => formatNumber(n, 0)} />
        </Section>
        <Section title={t.reports.costTrend}>
          <LineChart
            points={points.map((p) => ({ label: shortMonth(p.monthKey), value: p.agentCostUsd }))}
            color="var(--chart-4)"
            formatValue={(n) => `$${formatNumber(n, 1)}`}
          />
        </Section>
        <Section title={t.dashboard.conversion}>
          <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr:nth-child(even)]:bg-secondary/30">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.month}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.inquiries}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.leads}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.quotes}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.bookings}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.won}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.monthKey} className="border-t">
                  <td className="h-11 px-3 font-mono text-xs">{p.monthKey}</td>
                  <td className="h-11 px-3 tabular-nums">{p.inquiries}</td>
                  <td className="h-11 px-3 tabular-nums">{p.newLeads}</td>
                  <td className="h-11 px-3 tabular-nums">{p.quotes}</td>
                  <td className="h-11 px-3 tabular-nums">{p.bookings}</td>
                  <td className="h-11 px-3 tabular-nums">{p.wonLeads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}

function SupportTab({ locale }: { locale: "ar" | "en" }) {
  const { t } = useT();
  const r = useQuery(api.reports.support, { days: 30 });
  if (!r) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  const minutes = (n: number | null) => (n === null ? "—" : n >= 120 ? `${formatNumber(n / 60, 1)} س` : `${formatNumber(n, 0)} د`);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat
          label={`${t.reports.inquiries} (${t.reports.days30})`}
          value={formatNumber(r.inbound)}
          hint={`${t.inbox.outbound}: ${formatNumber(r.outbound)}`}
        />
        <Stat
          label={`${t.reports.responseTime} · ${t.reports.median}`}
          value={minutes(r.medianResponseMinutes)}
          hint={`${t.reports.avg} ${minutes(r.avgResponseMinutes)} · ${t.reports.p90} ${minutes(r.p90ResponseMinutes)}`}
          warn={(r.medianResponseMinutes ?? 0) > 120}
        />
        <Stat label={t.reports.escalationRate} value={formatPercent(r.escalationRatePercent)} hint={`${r.escalated}/${r.classified}`} />
        <Stat label={t.reports.complaints} value={formatNumber(r.complaints)} warn={r.complaints > 0} />
        <Stat
          label={t.reports.autoShare}
          value={formatPercent(r.messageApprovals.autoSharePercent)}
          hint={`${r.messageApprovals.auto}/${r.messageApprovals.decided}`}
        />
        <Stat
          label={t.reports.overrideRate}
          value={formatPercent(r.messageApprovals.overrideRatePercent)}
          hint={`${t.common.reject} ${r.messageApprovals.rejected} · ${t.common.edit} ${r.messageApprovals.edited}`}
          warn={(r.messageApprovals.overrideRatePercent ?? 0) > 30}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={t.reports.byChannel} onExport={() => downloadCsv("support-by-channel.csv", toEntries(r.byChannel, locale))}>
          <BreakdownBars items={toEntries(r.byChannel, locale)} />
        </Section>
        <Section title={t.reports.byKind}>
          <BreakdownBars items={toEntries(r.byKind, locale)} color="var(--chart-4)" />
        </Section>
        <Section title={t.reports.byStatus}>
          <BreakdownBars items={toEntries(r.byStatus, locale)} color="var(--chart-3)" />
        </Section>
        <Section title={t.reports.openNow}>
          <div className="space-y-1 text-sm">
            {(["NEW", "REPLY_PROPOSED", "ESCALATED"] as const).map((s) => (
              <div key={s} className="flex items-center justify-between">
                <StatusBadge value={s} />
                <Link href={`/inbox`} className="tabular-nums underline-offset-4 hover:underline">
                  {r.openNow[s]}
                </Link>
              </div>
            ))}
          </div>
        </Section>
        <Section title={t.reports.followUpsByStatus}>
          <BreakdownBars items={toEntries(r.followUps, locale)} color="var(--chart-6)" />
        </Section>
      </div>
    </div>
  );
}

function AgentsTab({ locale }: { locale: "ar" | "en" }) {
  const { t } = useT();
  const r = useQuery(api.reports.agents, {});
  if (!r) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  return (
    <Section
      title={`${t.reports.agentsTab} — ${r.monthKey}`}
      onExport={() =>
        downloadCsv(
          `agents-${r.monthKey}.csv`,
          r.rows.map((x) => ({ ...x, byOrigin: JSON.stringify(x.byOrigin), approvals: JSON.stringify(x.approvals) })),
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr:nth-child(even)]:bg-secondary/30">
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.agent}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.tasks}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.completed}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.failed}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.cancelled}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.active}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.avgSteps}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.avgCost}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.avgDuration}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.unsupported}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.approvals}</th>
              <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.overrideRate}</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.agentSlug} className="border-t">
                <td className="h-11 px-3">
                  <AgentBadge slug={x.agentSlug} />
                  <div className="text-xs text-muted-foreground">
                    {Object.entries(x.byOrigin)
                      .map(([o, n]) => `${labelOf(o, locale)} ${n}`)
                      .join(" · ")}
                  </div>
                </td>
                <td className="h-11 px-3 tabular-nums">{x.tasks}</td>
                <td className="h-11 px-3 tabular-nums">{x.completed}</td>
                <td className={`h-11 px-3 tabular-nums ${x.failed > 0 ? "text-destructive-text" : ""}`}>{x.failed}</td>
                <td className="h-11 px-3 tabular-nums">{x.cancelled}</td>
                <td className="h-11 px-3 tabular-nums">{x.active}</td>
                <td className="h-11 px-3 tabular-nums">{x.avgSteps ?? "—"}</td>
                <td className="h-11 px-3 tabular-nums">{x.avgCostUsd === null ? "—" : formatUsd(x.avgCostUsd)}</td>
                <td className="h-11 px-3 tabular-nums">{x.avgDurationMinutes ?? "—"}</td>
                <td className={`h-11 px-3 tabular-nums ${(x.unsupportedFactRatePercent ?? 0) > 20 ? "text-destructive-text" : ""}`}>
                  {formatPercent(x.unsupportedFactRatePercent)}
                </td>
                <td className="h-11 px-3 tabular-nums">
                  {x.approvals.requested} / {x.approvals.rejected} / {x.approvals.edited}
                </td>
                <td className={`h-11 px-3 tabular-nums ${(x.approvals.overrideRatePercent ?? 0) > 30 ? "text-destructive-text" : ""}`}>
                  {formatPercent(x.approvals.overrideRatePercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CostTab() {
  const { t } = useT();
  const r = useQuery(api.reports.cost, {});
  if (!r) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  const over = r.projectedPercentOfBudget >= 100;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={`${t.dashboard.agentCost} · ${r.monthKey}`}
          value={formatUsd(r.totalUsd)}
          hint={`${formatPercent(r.percentOfBudget)} ${t.reports.budget} ${formatUsd(r.budgetUsd)}`}
        />
        <Stat
          label={t.reports.projected}
          value={formatUsd(r.projectedUsd)}
          hint={`${formatPercent(r.projectedPercentOfBudget)} · ${r.daysElapsed}/${r.daysInMonth}`}
          warn={over}
        />
        <Stat label={t.reports.escalatedCalls} value={formatNumber(r.escalatedCalls)} hint={formatUsd(r.escalatedCostUsd)} />
        <Stat label={t.reports.cacheShare} value={formatPercent(r.cacheReadSharePercent)} />
        <Stat label={t.reports.webSearches} value={formatNumber(r.webSearchRequests)} hint={formatUsd(r.webSearchRequests * 0.01)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t.reports.dailyCost} onExport={() => downloadCsv(`cost-${r.monthKey}.csv`, r.byDay)}>
          <LineChart
            points={r.byDay.slice(0, r.daysElapsed).map((d) => ({ label: String(d.day), value: d.costUsd }))}
            color="var(--chart-4)"
            formatValue={(n) => `$${formatNumber(n, 2)}`}
            reference={r.budgetUsd > 0 ? { value: r.budgetUsd / r.daysInMonth, label: `${t.reports.budget}/يوم` } : undefined}
          />
        </Section>
        <Section title={t.reports.byOrigin}>
          <BreakdownBars
            items={Object.entries(r.byOrigin).map(([k, v]) => ({ label: `${k} (${v.calls})`, value: v.costUsd }))}
            formatValue={(n) => formatUsd(n)}
          />
        </Section>
        <Section title={t.reports.byModel}>
          <BreakdownBars
            items={r.byModel.map((m) => ({ label: `${m.model} (${m.calls})`, value: m.costUsd }))}
            formatValue={(n) => formatUsd(n)}
            color="var(--chart-1)"
          />
        </Section>
        <Section title={t.reports.byAgent}>
          <div className="space-y-1 text-sm">
            {r.byAgent.map((a) => (
              <div key={a.agentSlug} className="flex items-center justify-between">
                <AgentBadge slug={a.agentSlug} />
                <span className={`tabular-nums ${a.percentOfBudget >= 80 ? "text-destructive-text" : ""}`}>
                  {formatUsd(a.costUsd)} / {formatUsd(a.budgetUsd)} ({formatPercent(a.percentOfBudget)})
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function BookingsTab({ locale }: { locale: "ar" | "en" }) {
  const { t } = useT();
  const r = useQuery(api.reports.bookings, {});
  if (!r) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label={t.reports.bookings} value={formatNumber(r.total)} />
        <Stat label={t.reports.leadTime} value={r.avgLeadTimeDays === null ? "—" : formatNumber(r.avgLeadTimeDays, 1)} />
        <Stat label={t.reports.upcoming} value={formatNumber(r.upcoming.length)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t.reports.byStatus}>
          <BreakdownBars items={toEntries(r.byStatus, locale)} />
        </Section>
        <Section title={t.reports.departures}>
          <BarChart
            data={r.departuresByMonth.map((d) => ({ label: shortMonth(d.monthKey), values: { departures: d.departures, pax: d.pax } }))}
            series={[
              { key: "departures", name: t.reports.departures },
              { key: "pax", name: t.reports.pax },
            ]}
          />
        </Section>
        <Section title={t.reports.byProduct} onExport={() => downloadCsv("bookings-by-product.csv", r.byProduct)}>
          <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr:nth-child(even)]:bg-secondary/30">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.byProduct}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.bookings}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.reports.pax}</th>
                <th className="h-10 px-3 text-start text-xs font-medium text-muted-foreground">{t.dashboard.revenue}</th>
              </tr>
            </thead>
            <tbody>
              {r.byProduct.map((p) => (
                <tr key={p.productId ?? "none"} className="border-t">
                  <td className="h-11 px-3">
                    {p.productId ? (
                      <Link href={`/products/${p.productId}`} className="underline-offset-4 hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      p.name
                    )}
                  </td>
                  <td className="h-11 px-3 tabular-nums">{p.bookings}</td>
                  <td className="h-11 px-3 tabular-nums">{p.pax}</td>
                  <td className="h-11 px-3 tabular-nums">{formatNumber(p.revenueOmr, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title={t.reports.upcoming} onExport={() => downloadCsv("upcoming-departures.csv", r.upcoming)}>
          {r.upcoming.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
          <div className="space-y-1 text-sm">
            {r.upcoming.map((b) => (
              <div key={b._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div>
                  <div className="font-medium">
                    {b.customerName} · {b.product ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.businessId} · {formatDate(b.travelDateFrom, locale)} → {formatDate(b.travelDateTo, locale)} · {b.pax} {t.reports.pax}
                  </div>
                </div>
                <StatusBadge value={b.status} />
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
