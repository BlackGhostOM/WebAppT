"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LEAD_STAGES } from "@/convex/lib/vocab";
import { AskAgentButton } from "@/components/ask-agent-button";
import { StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { LeadDialog } from "@/components/pipeline/lead-dialog";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

export default function PipelinePage() {
  const { t, locale } = useT();
  const data = useQuery(api.leads.pipeline);
  const report = useQuery(api.leads.report, {});
  const [selected, setSelected] = useState<Id<"leads"> | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.pipeline}
        description="العملاء المحتملون حسب المرحلة، والعروض التجارية المبنية على منتجات فعّالة فقط، وتقرير التحويل من قاعدة البيانات."
        actions={
          <>
            <AskAgentButton
              label="اطلب من وكيل المبيعات"
              template="راجع خط المبيعات: حدّد العملاء الراكدين والمتابعات المتأخرة، واقترح رسالة متابعة لكل منهم بلغته، وأعدّ عروضاً للمؤهلين من المنتجات الفعّالة، وقدّم تقرير التحويل لهذا الشهر."
            />
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/data/leads?new=1" />}>
              {t.data.newRecord}
            </Button>
          </>
        }
      />

      {report && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t.pipeline.openValue} value={formatNumber(report.totalOpenExpectedValueOmr, 0)} tone="primary" />
          <StatCard label={t.pipeline.staleLeads} value={formatNumber(report.staleLeads.length)} tone={report.staleLeads.length > 0 ? "warn" : "default"} />
          <StatCard
            label={t.pipeline.overdueFollowUps}
            value={formatNumber(report.overdueFollowUps.length)}
            tone={report.overdueFollowUps.length > 0 ? "warn" : "default"}
          />
          <StatCard label={t.pipeline.quoteToBooking} value={formatPercent(report.conversion.quoteToBookingPercent)} />
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {LEAD_STAGES.map((s) => {
          const column = (data?.leads ?? []).filter((l) => l.stage === s);
          const stale = new Set(report?.staleLeads.map((l) => l._id) ?? []);
          return (
            <div key={s} className="rounded-xl border border-border bg-secondary/50 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <StatusBadge value={s} />
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </div>
              <div className="space-y-2">
                {column.map((lead) => (
                  <button
                    key={lead._id}
                    type="button"
                    onClick={() => setSelected(lead._id)}
                    className="block w-full rounded-lg border border-border bg-card p-3 text-start text-sm shadow-xs transition-colors hover:bg-accent/60"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium">{lead.contactName}</span>
                      {stale.has(lead._id) && <span className="text-xs font-medium text-warning-text">{t.pipeline.stale}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {labelOf(lead.channel, locale)} · {formatMoney(lead.expectedValue, locale)}
                    </div>
                    {lead.nextFollowUpAt && (
                      <div className={`text-xs ${lead.nextFollowUpAt < Date.now() ? "text-destructive-text" : "text-muted-foreground"}`}>
                        {t.pipeline.followUp}: {formatDate(lead.nextFollowUpAt, locale)}
                      </div>
                    )}
                    {lead.lostReason && <div className="text-xs text-destructive-text">{lead.lostReason}</div>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <section>
        <h2 className="mb-2 font-heading text-base font-semibold">{t.pipeline.quotes}</h2>
        {data?.quotes.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {data?.quotes.map((q) => (
            <button
              key={q._id}
              type="button"
              onClick={() => setSelected(q.leadId)}
              className="rounded-lg border border-border bg-card p-3 text-start text-sm shadow-xs transition-colors hover:bg-accent/60"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{q.businessId}</span>
                <StatusBadge value={q.status} />
              </div>
              <div className="text-xs text-muted-foreground">
                V{q.version} · منتج {q.productVersion ?? "—"} · حتى {formatDate(q.validUntil, locale)}
              </div>
              <div className="mt-1 tabular-nums">{formatMoney(q.totals.customerSellingPrice, locale)}</div>
              {q.priceWarnings.length > 0 && (
                <div className="mt-1 text-xs text-warning-text">
                  ⚠️ {q.priceWarnings.length} {t.pipeline.priceWarnings}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {report && Object.keys(report.lostReasons).length > 0 && (
        <section className="text-sm">
          <h2 className="mb-1 font-heading text-base font-semibold">{t.pipeline.lostReasons}</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(report.lostReasons).map(([reason, count]) => (
              <span key={reason} className="rounded-md border px-2 py-1 text-xs">
                {reason}: {count}
              </span>
            ))}
          </div>
        </section>
      )}

      <LeadDialog leadId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
